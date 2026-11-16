/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/**/*.html', './public/**/*.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        serif: ['"Playfair Display"', 'serif'],
      },
      colors: {
        soga: {
          50: '#fdfaf6',
          100: '#f8f1e7',
          200: '#efe0cb',
          300: '#e2c6a3',
          400: '#d3a675',
          500: '#c4894f',
          600: '#b3713e',
          700: '#945833',
          800: '#78472e',
          900: '#3d2316',
          950: '#24130b',
        },
      },
    },
  },
  plugins: [],
};
