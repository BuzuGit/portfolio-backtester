import type { Metadata } from 'next'
import './globals.css'

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode  // The actual page content gets passed here
}) {
  return (
    <html lang="en">
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
