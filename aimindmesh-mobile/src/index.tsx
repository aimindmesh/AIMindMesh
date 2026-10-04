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
import { initSecretStore } from './services/security/secretStore';
import { migrateSpeakerCalibration } from './services/speaker/speakerCalibration';

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
  // API keys are read synchronously by the first render: load them first (never throws)
  await initSecretStore();
  // New speaker features (ECAPA as WeSpeaker computes it): old thresholds and the enrolled voice go, once
  migrateSpeakerCalibration();

  // Test builds only: the on-device eval harness, driven from the PC through DevTools
  if ((import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_AIMM_EVAL === '1') {
    import('./services/eval/deviceEval').then(m => m.installDeviceEval()).catch(e => console.error('[AI Mind Mesh] Eval harness not installed', e));
  }

  console.log('[AI Mind Mesh] React root created. Rendering App...');
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
})();

console.log('[AI Mind Mesh] App render command issued.');
