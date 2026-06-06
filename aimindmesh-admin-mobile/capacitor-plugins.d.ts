export {}

declare global {
  interface Window {
    // Custom bridge placeholder
    CapacitorCustomBridge?: {
      echo: (value: string) => Promise<{ value: string }>;
    };
  }
}
