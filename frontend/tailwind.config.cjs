/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff8ff',
          100: '#dbeefe',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
          900: '#0c1e4d',
        },
        estado: {
          programada: '#2563eb',
          realizada: '#16a34a',
          pendiente: '#ca8a04',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
