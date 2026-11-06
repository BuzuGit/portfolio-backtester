// Tailwind's own colour scales, to borrow amber from below
const twColors = require('tailwindcss/colors');

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Tell Tailwind which files to scan for class names
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // "dark:" classes follow the "dark" class on <html> (the left-panel switch), not the computer's
  // own light/dark setting. Almost all dark styling lives in app/dark.css; "dark:" is only used
  // where an element must show or hide by mode, like the sun/moon icon on the switch.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // The app's flat light-grey page background. Defined once here and used both by the
        // page (class "bg-page") and by globals.css (the strip kept free for the scrollbar),
        // so the two can never drift apart.
        page: '#f1f2f4',

        // ---------- THE APP'S COLOUR THEME ("Calm", chosen 2026-11-05) ----------
        // Green and red mean gain and loss and nothing else, so there is ONE green and ONE red:
        // the 500, 600 and 700 shades are deliberately identical, which turns the many
        // text-green-600 / -700 / #16a34a variants the pages used into the same colour.
        // The lighter shades are soft tints of it (backgrounds), 800-900 darker (text on a tint).
        // The 500-700 shades are the theme's own variables (app/theme.css, which also holds their
        // dark-mode versions), the same two colours as GAIN / LOSS in the component.
        green: {
          50: '#eef6f1', 100: '#d9ecdf', 200: '#b5d9c1', 300: '#86bf98', 400: '#559f70',
          500: 'var(--c-gain)', 600: 'var(--c-gain)', 700: 'var(--c-gain)', 800: '#245f3d', 900: '#1a452c',
        },
        red: {
          50: '#fbf1f0', 100: '#f6e0dd', 200: '#efc5c0', 300: '#dc8a82', 400: '#cb6259',
          500: 'var(--c-loss)', 600: 'var(--c-loss)', 700: 'var(--c-loss)', 800: '#93342e', 900: '#6e2722',
        },
        // Warnings are amber, only: the yellow and orange boxes / text the pages used for
        // "no data" notes and current drawdowns now draw in amber too.
        yellow: twColors.amber,
        orange: twColors.amber,
      },
    },
  },
  plugins: [],
}
