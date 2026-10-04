import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aimindmesh.mobile',
  appName: 'AMM Mobile',
  webDir: 'dist',
  server: {
    // http origin + cleartext: LAN servers (llama.cpp, AIMindMesh server) are plain HTTP.
    // No allowNavigation: the WebView never leaves the app; external links open in the browser.
    androidScheme: 'http',
    cleartext: true
  },
  android: {
    // webContentsDebuggingEnabled is left unset: Capacitor enables chrome://inspect on debug builds only
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