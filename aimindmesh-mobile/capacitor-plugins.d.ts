declare module '@capacitor/core' {
  interface PluginRegistry {
    FilePicker: any;
    Filesystem: any;
    OpenWakeWord: any;
  }
}

declare module 'wakeword-capacitor' {
  export const OpenWakeWord: any;
  export * from 'wakeword-capacitor/dist/esm/definitions';
}

export {};