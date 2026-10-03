/**
 * Back button handlers registered by screens that need to decide themselves how to close
 * (e.g. meeting mode, which must not drop a recording). A handler returns true when it
 * consumed the press.
 */
type BackHandler = () => boolean;

const handlers = new Map<string, BackHandler>();

/** Registers the handler for a screen; the returned function unregisters it */
export function registerBackHandler(id: string, handler: BackHandler): () => void {
    handlers.set(id, handler);
    return () => {
        if (handlers.get(id) === handler) handlers.delete(id);
    };
}

/** Runs the screen's handler: undefined when the screen registered none */
export function runBackHandler(id: string): boolean | undefined {
    const handler = handlers.get(id);
    return handler ? handler() : undefined;
}
