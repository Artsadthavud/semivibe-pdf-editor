import React from 'react';
import ReactDOM from 'react-dom/client';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import workerAssetUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import App from './App';
import './styles.css';

// Ensure pdf.js knows where to find its worker bundle.
if (typeof workerAssetUrl === 'string' && workerAssetUrl.length > 0) {
	if (typeof window !== 'undefined') {
		(window as any).__PDF_WORKER_URL = workerAssetUrl;
	}
	try {
		GlobalWorkerOptions.workerSrc = workerAssetUrl;
	} catch (err) {
		// Ignore assignment issues—runtime PDF loader will fall back to disableWorker.
	}
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
