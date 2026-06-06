/**
 * polyfills.ts
 * Robust polyfills for legacy Chromium/Android WebViews.
 * Handles missing AbortController, AbortSignal, and IntersectionObserver.
 */

// 1. AbortController / AbortSignal Polyfill
if (typeof window.AbortController === 'undefined') {
    // @ts-ignore
    window.AbortController = class AbortController {
        signal = {
            aborted: false,
            addEventListener: () => { },
            removeEventListener: () => { },
            dispatchEvent: () => true,
            onabort: null
        };
        abort() {
            this.signal.aborted = true;
            if (typeof this.signal.onabort === 'function') {
                // @ts-ignore
                this.signal.onabort();
            }
        }
    };
}

if (typeof window.AbortSignal === 'undefined') {
    // @ts-ignore
    window.AbortSignal = class AbortSignal {
        static timeout(ms: number) {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), ms);
            return controller.signal;
        }
    };
} else if (!(window.AbortSignal as any).timeout) {
    (window.AbortSignal as any).timeout = (ms: number) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
    };
}

// 2. IntersectionObserver Safety
if (typeof window.IntersectionObserver === 'undefined') {
    // @ts-ignore
    window.IntersectionObserver = class IntersectionObserver {
        observe() { }
        unobserve() { }
        disconnect() { }
    };
}

console.log('[AI Mind Mesh] Polyfills successfully applied.');
