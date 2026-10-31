import type { Metadata } from 'next'
import './globals.css'
// Dark mode colours. Every rule in it only applies while <html> has the class "dark",
// so it changes nothing in light mode. Imported after globals.css so it can override it.
import './dark.css'

/*
  This is the ROOT LAYOUT - think of it as the "wrapper" for your entire app.
  Every page in your app will be rendered inside this layout.

  It's like the frame of a house - it stays the same while the rooms (pages) change.
*/

// Metadata for SEO and browser tab info
export const metadata: Metadata = {
  title: 'Portfolio Backtester',
  description: 'Backtest investment portfolios with historical data',
  // iPhone: "Share > Add to Home Screen" then opens the app full screen, without Safari's address
  // bar, under the name "Backtester" with the icon in public/icons. Desktop browsers ignore these.
  // (The icons are plain PNG files, drawn once by a small script: a dark slate-to-black square with
  // a white rising line. There is deliberately no app/icon file, which Next.js would also turn
  // into the desktop browser-tab icon.)
  appleWebApp: { capable: true, title: 'Backtester', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
}

// Android: the app-info file (public/manifest.webmanifest) that lets Chrome offer "Install app" and
// open it full screen with its own icon. Linked only on a phone-width screen, so desktop Chrome never
// sees it and shows no install button in its address bar; desktop stays exactly as it was.
const linkPhoneManifest = `try{if(matchMedia('(max-width: 767px)').matches){var l=document.createElement('link');l.rel='manifest';l.href='/manifest.webmanifest';document.head.appendChild(l)}}catch(e){}`

// Runs in the browser before anything is painted: if dark mode was chosen last time, switch it on
// now. Done here rather than in React because React only starts after the page has been shown
// once, which would flash the light page for a moment on every load in dark mode.
// Light is the default: nothing happens unless "dark" was saved.
const applySavedTheme = `try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode  // The actual page content gets passed here
}) {
  return (
    // suppressHydrationWarning: the script above may add the "dark" class before React starts,
    // so React would otherwise complain that <html> doesn't match what the server sent.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: applySavedTheme }} />
        <script dangerouslySetInnerHTML={{ __html: linkPhoneManifest }} />
      </head>
      {/*
        The body tag wraps all content.
        antialiased = makes text look smoother on screens
      */}
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
