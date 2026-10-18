/** @type {import('tailwindcss').Config} */
module.exports = {
  // Tell Tailwind which files to scan for class names
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
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
