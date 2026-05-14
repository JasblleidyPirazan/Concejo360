import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [tailwind(), react()],
  site: 'https://concejo360.netlify.app',
  output: 'static',
  vite: {
    ssr: {
      noExternal: ['chart.js', 'react-chartjs-2'],
    },
  },
});
