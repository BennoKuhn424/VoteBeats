import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split heavy, rarely-changing vendor libs into their own long-lived
        // cacheable chunks so an app-code deploy doesn't bust the whole bundle,
        // and so the initial parse is spread across parallel requests. Route
        // chunks (via React.lazy in App.jsx) split automatically on top of this.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@sentry')) return 'sentry';
          if (id.includes('react-router')) return 'router';
          if (id.includes('react-dom') || id.includes('/scheduler/')) return 'react';
          if (id.includes('socket.io') || id.includes('engine.io')) return 'socket';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('qrcode')) return 'qrcode';
          return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    pool: 'forks',
  },
  server: {
    port: 5173,
    host: true, // Expose to network so phone can connect
    allowedHosts: true, // Allow ngrok and other tunnels
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
