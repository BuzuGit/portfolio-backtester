<#
.SYNOPSIS
  One-command publish for the Claude projects: branch, commit, push, PR, squash-merge, clean up.

.DESCRIPTION
  Replaces the ten-or-so separate git/PowerShell commands this flow used to take. Everything
  runs inside one script, which means ONE permission prompt instead of one per command, and
  none of the credential boilerplate gets retyped each time.

  Works in any of the repos under C:\Dev\Claude (portfolio-backtester, cash-flows-tracker,
  StooqAnalyzer). It reads the GitHub owner/repo from the git remote and asks GitHub what the
  default branch is, so it does not care that StooqAnalyzer uses "master" while the others
  use "main".

  Network calls are retried, because DNS resolution to github.com on this machine fails
  intermittently. Retries live in here rather than in shell loops, since shell loops are what
  used to defeat the permission allowlist.

.PARAMETER Title
  The commit subject and the PR title. The only required argument.

.PARAMETER Body
  Optional longer description. Keep it short - nobody reads a PR you merge yourself.

.PARAMETER Branch
  Optional branch name. Defaults to a slug of the title, e.g. "fix-the-thing".

.PARAMETER All
  Also commit files git does not track yet. Off by default so stray screenshots and scratch
  files never get published by accident.

.PARAMETER Exclude
  Paths to keep out of the commit. Defaults to the local Claude settings file, which is
  machine-specific and should not travel.

.PARAMETER NoMerge
  Create the pull request but stop there, leaving the merge to you.

.EXAMPLE
  publish.ps1 "Fix the date formatting"

.EXAMPLE
  publish.ps1 "Add income column" -Body "Splits realised profit into price gain and dividends."
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Title,
    [string]$Body = "",
    [string]$Branch = "",
    [switch]$All,
    [string[]]$Exclude = @(".claude/settings.local.json"),
    [switch]$NoMerge,
    # Rehearses everything that happens on your machine - staging, branching, committing - and
    # checks GitHub is reachable, then undoes it all and reports what it WOULD have published.
    # Nothing is pushed. Use it when you want to see the plan before committing to it.
    [switch]$DryRun,
    # Skip waiting for the Vercel build. Publishing is meant to end with the change actually
    # live, so by default we wait and report whether the deployment succeeded.
    [switch]$NoWait
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

function Write-Step { param([string]$Msg) Write-Host "==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "    $Msg" -ForegroundColor Green }
function Fail       { param([string]$Msg) Write-Host "!!! $Msg" -ForegroundColor Red; exit 1 }

# Runs a git command and returns its output. Native executables do not throw on failure, so we
# judge success by $LASTEXITCODE rather than by exceptions.
# NOTE: deliberately a *simple* function with no param() block. Adding [Parameter()] would make
# this an "advanced" function, which silently grants it PowerShell's common parameters -- and then
# "Invoke-Git branch -D name" has its -D swallowed as a prefix match for -Debug, so the command
# quietly becomes "git branch name" and deletes nothing. Plain $args passes every flag through
# untouched. (PowerShell still eats a bare "--" at the call site, so no command here uses one.)
function Invoke-Git {
    # git writes ordinary chatter to stderr (line-ending warnings, "Switched to branch", and so
    # on). With $ErrorActionPreference = Stop, redirecting stderr would turn each of those into a
    # fatal NativeCommandError and kill the script over a warning. So we relax the preference for
    # the duration of the call, keep stderr for diagnostics, and judge success only by the exit
    # code -- which is the one thing a native executable reports reliably.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git.exe $args 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{ Ok = ($code -eq 0); Out = $out.Trim() }
}

# Retries anything that touches the network. The DNS failures here are transient - a retry a
# few seconds later almost always succeeds, so there is nothing to diagnose, only to repeat.
function Retry {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Action,
        [string]$What = "operation",
        [int]$Tries = 6,
        [int]$DelaySeconds = 4
    )
    for ($i = 1; $i -le $Tries; $i++) {
        try {
            $result = & $Action
            if ($null -ne $result -and $result.PSObject.Properties.Name -contains "Ok" -and -not $result.Ok) {
                throw $result.Out
            }
            if ($i -gt 1) { Write-Ok "$What succeeded on attempt $i" }
            return $result
        } catch {
            $msg = $_.Exception.Message
            if ($i -eq $Tries) { Fail "$What failed after $Tries attempts. Last error: $msg" }
            Write-Host "    $What attempt $i failed, retrying..." -ForegroundColor DarkYellow
            Start-Sleep -Seconds $DelaySeconds
        }
    }
}

# Pulls the GitHub token out of Windows Credential Manager, so no token is ever typed,
# stored in this file, or committed. Same store the git CLI itself uses.
function Get-GitHubToken {
    if (-not ("CredentialManagerInterop" -as [type])) {
        $code = @"
using System; using System.Runtime.InteropServices; using System.Text;
public class CredentialManagerInterop {
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
    [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr buffer);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags; public int Type; public string TargetName; public string Comment;
        public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
        public int Persist; public int AttributeCount; public IntPtr Attributes;
        public string TargetAlias; public string UserName;
    }
    public static string GetPassword(string target) {
        IntPtr ptr = IntPtr.Zero;
        if (!CredRead(target, 1, 0, out ptr)) return null;
        var cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
        byte[] bytes = new byte[cred.CredentialBlobSize];
        Marshal.Copy(cred.CredentialBlob, bytes, 0, cred.CredentialBlobSize);
        CredFree(ptr); return Encoding.Unicode.GetString(bytes);
    }
}
"@
        Add-Type -TypeDefinition $code -Language CSharp
    }
    $t = [CredentialManagerInterop]::GetPassword("git:https://github.com")
    if (-not $t) { Fail "No GitHub token in Windows Credential Manager under 'git:https://github.com'." }
    return $t
}

# PowerShell 5.1 sends request bodies in the wrong encoding, so any non-ASCII character makes
# GitHub reject the call with a confusing 400. Encoding to UTF-8 bytes ourselves avoids it.
function Invoke-GitHub {
    param([string]$Uri, [string]$Method, $BodyObject, $Headers)
    $json  = $BodyObject | ConvertTo-Json -Depth 6
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    return Invoke-RestMethod -Uri $Uri -Method $Method -Headers $Headers -Body $bytes -ContentType "application/json; charset=utf-8"
}

# ---------------------------------------------------------------------------
# Work out where we are
# ---------------------------------------------------------------------------

Write-Step "Checking the repository"

$top = Invoke-Git rev-parse --show-toplevel
if (-not $top.Ok) { Fail "Not inside a git repository." }
$repoRoot = $top.Out
Set-Location $repoRoot

$remote = Invoke-Git remote get-url origin
if (-not $remote.Ok) { Fail "This repository has no 'origin' remote." }

# Accept both https://github.com/owner/repo(.git) and git@github.com:owner/repo(.git)
if ($remote.Out -notmatch 'github\.com[/:]([^/]+)/([^/\s]+?)(\.git)?$') {
    Fail "Could not read owner/repo from the remote: $($remote.Out)"
}
$owner = $Matches[1]
$repo  = $Matches[2]
Write-Ok "$owner/$repo  ($repoRoot)"

# ---------------------------------------------------------------------------
# Talk to GitHub
# ---------------------------------------------------------------------------

Write-Step "Connecting to GitHub"

$token = Get-GitHubToken
$headers = @{
    "Authorization"        = "Bearer $token"
    "Accept"               = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
    "User-Agent"           = "claude-publish-script"
}

$repoInfo = Retry -What "repo lookup" -Action {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo" -Headers $headers
}
$baseBranch = $repoInfo.default_branch
Write-Ok "default branch is '$baseBranch'"

# ---------------------------------------------------------------------------
# Decide what to commit
# ---------------------------------------------------------------------------

Write-Step "Staging changes"

$startBranch = (Invoke-Git rev-parse --abbrev-ref HEAD).Out

# -u stages only files git already tracks. Without -All, untracked files are left alone, which
# is what stops stray screenshots and scratch files from being published by accident.
if ($All) { $null = Invoke-Git add -A } else { $null = Invoke-Git add -u }

foreach ($path in $Exclude) {
    if (Test-Path (Join-Path $repoRoot $path)) {
        $null = Invoke-Git reset -q HEAD $path
    }
}

$staged = Invoke-Git diff --cached --name-only
if (-not $staged.Out) {
    Fail "Nothing staged. Either there are no changes, or everything changed is untracked (use -All) or excluded."
}
$stagedFiles = $staged.Out -split "`n"
Write-Ok "$($stagedFiles.Count) file(s):"
$stagedFiles | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }

# ---------------------------------------------------------------------------
# Branch and commit
# ---------------------------------------------------------------------------

if (-not $Branch) {
    # Turn the title into a branch-safe slug: lowercase, non-alphanumerics to dashes, trimmed.
    $slug = $Title.ToLower() -replace '[^a-z0-9]+', '-'
    $slug = $slug.Trim('-')
    if ($slug.Length -gt 48) { $slug = $slug.Substring(0, 48).Trim('-') }
    $Branch = $slug
}

Write-Step "Committing on '$Branch'"

$null = Invoke-Git checkout -b $Branch
if ($LASTEXITCODE -ne 0) { Fail "Could not create branch '$Branch' (does it already exist?)" }

$msgFile = Join-Path $env:TEMP ("publish-msg-" + [guid]::NewGuid().ToString("N") + ".txt")
$lines = @($Title)
if ($Body) { $lines += @("", $Body) }
$lines += @("", "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>")
Set-Content -LiteralPath $msgFile -Value ($lines -join "`n") -Encoding utf8

$commit = Invoke-Git commit -F $msgFile
Remove-Item -LiteralPath $msgFile -Force -ErrorAction SilentlyContinue
if (-not $commit.Ok) { Fail "Commit failed: $($commit.Out)" }
Write-Ok ((Invoke-Git rev-parse --short HEAD).Out)

# ---------------------------------------------------------------------------
# Push, PR, merge
# ---------------------------------------------------------------------------

if ($DryRun) {
    Write-Step "Dry run - undoing local changes and stopping here"
    # Put the working tree back exactly as it was: drop the commit but keep the edits staged,
    # return to the branch we started on, and remove the temporary branch.
    $null = Invoke-Git reset --soft HEAD~1
    $null = Invoke-Git checkout $startBranch
    $null = Invoke-Git branch -D $Branch
    Write-Host ""
    Write-Host "Nothing was pushed. It would have:" -ForegroundColor Yellow
    Write-Host "  branch  $Branch" -ForegroundColor Yellow
    Write-Host "  commit  $Title" -ForegroundColor Yellow
    Write-Host "  PR into $baseBranch on $owner/$repo, then squash-merge and clean up." -ForegroundColor Yellow
    Write-Host "Your changes are still staged, and you are back on '$startBranch'." -ForegroundColor Yellow
    exit 0
}

Write-Step "Pushing"
$null = Retry -What "push" -Action { Invoke-Git push -u origin $Branch }
Write-Ok "pushed"

Write-Step "Opening the pull request"
$prBody = if ($Body) { $Body } else { $Title }
$pr = Retry -What "PR creation" -Action {
    Invoke-GitHub -Uri "https://api.github.com/repos/$owner/$repo/pulls" -Method Post -Headers $headers -BodyObject @{
        title = $Title; head = $Branch; base = $baseBranch; body = $prBody
    }
}
Write-Ok "PR #$($pr.number): $($pr.html_url)"

if ($NoMerge) {
    Write-Host ""
    Write-Host "Stopped before merging, as asked. Branch '$Branch' is pushed and the PR is open." -ForegroundColor Yellow
    exit 0
}

Write-Step "Merging"
$null = Retry -What "merge" -Action {
    Invoke-GitHub -Uri "https://api.github.com/repos/$owner/$repo/pulls/$($pr.number)/merge" -Method Put -Headers $headers -BodyObject @{
        merge_method = "squash"; commit_title = "$Title (#$($pr.number))"
    }
}
Write-Ok "squash-merged"

# ---------------------------------------------------------------------------
# Clean up and prove it worked
# ---------------------------------------------------------------------------

Write-Step "Syncing local $baseBranch"

$null = Invoke-Git checkout $baseBranch
$null = Retry -What "pull" -Action { Invoke-Git pull --ff-only }
$null = Invoke-Git branch -D $Branch
$null = Retry -What "remote branch delete" -Action { Invoke-Git push origin --delete $Branch }

# Never claim success without checking: local and remote must point at the same commit.
$local  = (Invoke-Git rev-parse HEAD).Out
$remoteHead = (Invoke-Git rev-parse "origin/$baseBranch").Out

if ($local -ne $remoteHead) {
    Fail "Merged, but local $baseBranch ($local) does not match origin ($remoteHead). Run 'git pull' and check."
}

# ---------------------------------------------------------------------------
# Wait for the deployment
# ---------------------------------------------------------------------------
# Merging is not the same as being live. Vercel builds after the merge and can fail on
# something a local typecheck never sees, which would sit broken in production unnoticed.
# Vercel reports build status back to GitHub as a commit status, so we can watch the merge
# commit through the API we already have a token for -- no separate Vercel login needed.
# Repos with no deployment hooked up (CashFlowsTracker) simply report nothing, and we say so.

$deployState = "skipped"
$deployUrl = ""

if (-not $NoWait) {
    Write-Step "Waiting for the deployment"
    $deadline = (Get-Date).AddMinutes(5)
    $emptyPolls = 0
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 10
        $status = $null
        try {
            $status = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/commits/$local/status" -Headers $headers
        } catch {
            continue   # transient DNS or rate limit; just poll again
        }
        if ($status.total_count -eq 0) {
            # Give it a little while in case the hook has not posted yet, then conclude
            # this repo simply has no deployment wired up.
            $emptyPolls++
            if ($emptyPolls -ge 3) { $deployState = "none"; break }
            continue
        }
        if ($status.state -ne "pending") {
            $deployState = $status.state
            $target = $status.statuses | Where-Object { $_.target_url } | Select-Object -First 1
            if ($target) { $deployUrl = $target.target_url }
            break
        }
        Write-Host "    building..." -ForegroundColor DarkGray
    }
    if ($deployState -eq "skipped") { $deployState = "timeout" }
}

Write-Host ""
Write-Host "Done. $baseBranch is at $((Invoke-Git rev-parse --short HEAD).Out) locally and on GitHub." -ForegroundColor Green
Write-Host "  $($pr.html_url)" -ForegroundColor Green

switch ($deployState) {
    "success" {
        Write-Host "  Deployment succeeded - the change is live." -ForegroundColor Green
        if ($deployUrl) { Write-Host "  $deployUrl" -ForegroundColor Green }
    }
    "failure" {
        Write-Host "  DEPLOYMENT FAILED - the merge is on GitHub but the site did NOT update." -ForegroundColor Red
        if ($deployUrl) { Write-Host "  $deployUrl" -ForegroundColor Red }
        exit 1
    }
    "error" {
        Write-Host "  DEPLOYMENT ERRORED - the merge is on GitHub but the site did NOT update." -ForegroundColor Red
        if ($deployUrl) { Write-Host "  $deployUrl" -ForegroundColor Red }
        exit 1
    }
    "none"    { Write-Host "  No deployment is wired up for this repo, so nothing to wait for." -ForegroundColor DarkGray }
    "timeout" { Write-Host "  Deployment still building after 5 minutes - check Vercel." -ForegroundColor Yellow }
    "skipped" { Write-Host "  Skipped the deployment check (-NoWait)." -ForegroundColor DarkGray }
}
