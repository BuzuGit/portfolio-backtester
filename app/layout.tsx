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
  // (statusBarStyle 'default' is the light top strip; on a phone in dark mode it is switched to
  // 'black', by the phoneBarColours script below and again by the component once it starts.)
  appleWebApp: { capable: true, title: 'Backtester', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
}

// Phones: the colour of the phone's own bars above and below the page (the clock/battery strip,
// the browser bar, Android's bottom bar). Without this they stay white, which looks wrong around
// the dark page. Only on a phone-width screen, so desktop is untouched:
//   theme-color (added here): Android and Safari paint their bars this colour (the page's own
//     background colour)
//   apple-mobile-web-app-status-bar-style (already in the page from the metadata above): the iPhone
//     home-screen app's top strip, switched to "black" in dark mode
// The component sets both again once it starts (React adds a second copy of the status-bar tag
// while starting up, after this script has run) and whenever the dark-mode button is pressed.
const phoneBarColours = `try{if(matchMedia('(max-width: 767px)').matches){var d=document.documentElement.classList.contains('dark');var t=document.createElement('meta');t.name='theme-color';t.content=d?'#0e1014':'#f1f2f4';document.head.appendChild(t);var s=document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');if(s&&d)s.content='black'}}catch(e){}`

// Android: the app-info file (public/manifest.webmanifest) that lets Chrome offer "Install app" and
// open it full screen with its own icon. Linked only on a phone-width screen, so desktop Chrome never
// sees it and shows no install button in its address bar; desktop stays exactly as it was.
// It deliberately has no "theme_color": an installed Android app paints its bottom button bar in
// that one fixed colour, which can't follow the dark-mode button (white under a dark page).
// Without it the bar follows the phone's own light/dark setting.
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
        {/* After applySavedTheme, so it already knows whether the page is dark */}
        <script dangerouslySetInnerHTML={{ __html: phoneBarColours }} />
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
