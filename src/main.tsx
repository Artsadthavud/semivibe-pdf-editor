import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Import the emitted worker asset URL (Vite `?url`) so we can set a same-origin
// worker script path for pdf.js. We keep a small runtime setter so this value
// is available early in app startup.
// @ts-ignore - Vite handles ?url imports
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import './styles.css';

if (typeof window !== 'undefined' && workerUrl) {
  try {
    (window as any).__PDF_WORKER_URL = workerUrl as any;
  } catch (e) {
    // ignore
  }
}
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
