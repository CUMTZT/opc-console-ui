import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = Object.fromEntries(
    [
      ['/api/server', env.SERVER_API_TARGET || 'http://127.0.0.1:8080'],
      ['/api/gateway', env.GATEWAY_API_TARGET || 'http://127.0.0.1:1234'],
    ].map(([prefix, target]) => [
      prefix,
      {
        target,
        changeOrigin: false,
        rewrite: (path) => '/api' + path.slice(prefix.length),
      },
    ]),
  );
  return {
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  };
});
