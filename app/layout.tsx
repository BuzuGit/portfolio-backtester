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
}

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
