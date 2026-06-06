import './polyfills';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// --- Global Error Handlers (Android WebView Stability) ---
window.addEventListener('error', (event) => {
  console.error('[AI Mind Mesh] Uncaught Error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[AI Mind Mesh] Unhandled Promise Rejection:', event.reason);
});

console.log('[AI Mind Mesh] index.tsx script started.');

const rootElement = document.getElementById('root');
console.log('[AI Mind Mesh] Root element found:', rootElement ? 'Yes' : 'No');

if (!rootElement) {
  console.error('[AI Mind Mesh] CRITICAL: Could not find root element to mount to.');
  throw new Error("Could not find root element to mount to");
}

import { PersistenceService } from './services/config/persistenceService';

console.log('[AI Mind Mesh] Creating React root...');
const root = createRoot(rootElement);

// Initialize persistence before rendering
(async () => {
  try {
    console.log('[AI Mind Mesh] Hydrating persistent settings...');
    await PersistenceService.hydrate();
  } catch (e) {
    console.error('[AI Mind Mesh] Failed to hydrate settings:', e);
  }

  console.log('[AI Mind Mesh] React root created. Rendering App...');
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
})();

console.log('[AI Mind Mesh] App render command issued.');
