import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'android-auto-capacitor': path.resolve(__dirname, './plugins/android-auto-capacitor/src/index.ts'),
      'audio-output-capacitor': path.resolve(__dirname, './plugins/audio-output-capacitor/src/index.ts'),
      'background-service-capacitor': path.resolve(__dirname, './plugins/background-service-capacitor/src/index.ts'),
      'litert-capacitor': path.resolve(__dirname, './plugins/litert-capacitor/src/index.ts'),
      'piper-capacitor': path.resolve(__dirname, './plugins/piper-capacitor/src/index.ts'),
      'speaker-embedding-capacitor': path.resolve(__dirname, './plugins/speaker-embedding-capacitor/src/index.ts'),
      'termux-capacitor': path.resolve(__dirname, './plugins/termux-capacitor/src/index.ts'),
      'text-embedding-capacitor': path.resolve(__dirname, './plugins/text-embedding-capacitor/src/index.ts'),
      'vad-capacitor': path.resolve(__dirname, './plugins/vad-capacitor/src/index.ts'),
      'vosk-capacitor': path.resolve(__dirname, './plugins/vosk-capacitor/src/index.ts'),
      'wakeword-capacitor': path.resolve(__dirname, './plugins/wakeword-capacitor/src/index.ts'),
      'whisper-capacitor': path.resolve(__dirname, './plugins/whisper-capacitor/src/index.ts')
    }
  },
  optimizeDeps: {
    exclude: [
      'android-auto-capacitor',
      'audio-output-capacitor',
      'background-service-capacitor',
      'fcm-capacitor',
      'litert-capacitor',
      'llama-cpp-capacitor',
      'piper-capacitor',
      'speaker-embedding-capacitor',
      'termux-capacitor',
      'text-embedding-capacitor',
      'vad-capacitor',
      'vosk-capacitor',
      'wakeword-capacitor',
      'whisper-capacitor'
    ]
  },
  server: {
    watch: {
      ignored: ['**/android/**', '**/ios/**', '**/build/**', '**/dist/**', '**/node_modules/**']
    }
  }
})