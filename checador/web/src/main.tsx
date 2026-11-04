import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './estilos.css';

createRoot(document.getElementById('app')!).render(<StrictMode><App /></StrictMode>);

// la app abre aunque no haya señal (sólo en producción: en desarrollo estorba la recarga de Vite)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js'); });
}
