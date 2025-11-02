import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// Configure Vite with an alias for the pdf.js worker and pre-bundling for pdfjs-dist.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Map some common worker entry specifiers to the legacy mjs file so Vite
      // can resolve the import when some code references the .js path.
      // Adjust as needed for other pdfjs-dist versions.
      'pdfjs-dist/build/pdf.worker.js': 'pdfjs-dist/legacy/build/pdf.worker.mjs',
      'pdfjs-dist/build/pdf.worker.min.js': 'pdfjs-dist/legacy/build/pdf.worker.mjs',
      'pdfjs-dist/build/pdf.worker.min.mjs': 'pdfjs-dist/legacy/build/pdf.worker.mjs',
      'pdfjs-dist/build/pdf.worker.mjs': 'pdfjs-dist/legacy/build/pdf.worker.mjs',
    }
  },
  optimizeDeps: {
    include: ['pdfjs-dist']
  },
  server: {
    port: 5173,
    host: 'localhost'
  }
});
