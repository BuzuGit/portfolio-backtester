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
      },
    },
  },
  plugins: [],
}
