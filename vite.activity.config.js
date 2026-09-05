import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    root: fileURLToPath(new URL('./activity', import.meta.url)),
    base: './',
    build: { outDir: '../public/schedule', emptyOutDir: true },
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3000' } }
});
