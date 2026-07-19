import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_PORT = process.env['TWOGRAPH_PORT'] ?? '4801';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/v1': `http://localhost:${API_PORT}`,
      '/openapi.json': `http://localhost:${API_PORT}`,
    },
  },
});
