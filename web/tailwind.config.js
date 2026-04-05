/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ghost: {
          low: '#16a34a',
          moderate: '#ea580c',
          high: '#dc2626',
          very_high: '#7c3aed',
        },
      },
    },
  },
  plugins: [],
};
