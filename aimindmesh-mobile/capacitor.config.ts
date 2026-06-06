import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aimindmesh.mobile',
  appName: 'AMM Mobile',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
    cleartext: true,
    // Allow mixed content for local development
    allowNavigation: ['*']
  },
  android: {
    // Allow WebView to access microphone and camera
    allowMixedContent: true,
    // Grant WebView permissions for getUserMedia
    // Grant WebView permissions for getUserMedia
    webContentsDebuggingEnabled: true,
    loggingBehavior: 'none'
  },
  plugins: {
    StatusBar: {
      style: 'dark',
      backgroundColor: '#1e1e2e', // Corresponds to 'surface' color from tailwind.config.js
      overlaysWebView: false,
    },
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#11111b', // Corresponds to 'background' color
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    Keyboard: {
      resize: 'body',
      style: 'dark',
      resizeOnFullScreen: true,
    },
  }
};

export default config;