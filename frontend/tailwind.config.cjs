/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#faf0ff',
          100: '#f0dafa',
          200: '#ddb4f0',
          500: '#9b33c7',
          600: '#7010a6',
          700: '#590884',
          800: '#420664',
          900: '#2b033e',
        },
        accent: {
          400: '#ffdf33',
          500: '#fcd700',
          600: '#d6b600',
        },
        estado: {
          programada: '#7010a6',
          realizada: '#16a34a',
          pendiente: '#fcd700',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
