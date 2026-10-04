/**
 * DevTools client of the app's WebView on a phone (adb forward to webview_devtools_remote_<pid>):
 * evaluates `window.__aimmEval.*` calls of the on-device harness (test builds, VITE_AIMM_EVAL=1).
 */
import { execFileSync } from 'node:child_process';

const APP = 'com.aimindmesh.mobile';

/** The connection dropped (a USB reset): the call can be repeated after reconnecting */
export class ConnectionLost extends Error {}

export class DeviceSession {
    private ws!: WebSocket;
    private nextId = 1;
    private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    private connected = false;

    private constructor(readonly serial: string, readonly port: number) {}

    static async open(serial: string, port = 9300): Promise<DeviceSession> {
        const session = new DeviceSession(serial, port);
        await session.attach();
        return session;
    }

    /** Forwards the WebView's DevTools socket and connects (again, after a USB reset) */
    private async attach(): Promise<void> {
        const adb = (...args: string[]) => execFileSync('adb', ['-s', this.serial, ...args], { encoding: 'utf8' }).trim();
        const pid = adb('shell', 'pidof', APP);
        if (!pid) throw new Error(`${APP} is not running on ${this.serial}`);
        adb('forward', `tcp:${this.port}`, `localabstract:webview_devtools_remote_${pid.split(/\s+/)[0]}`);
        const pages = await (await fetch(`http://127.0.0.1:${this.port}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
        const page = pages.find(p => p.type === 'page' && /localhost/.test(p.url)) ?? pages.find(p => p.type === 'page');
        if (!page) throw new Error('no WebView page to attach to');
        await this.connect(page.webSocketDebuggerUrl);
    }

    /** Waits for the phone to come back (up to two minutes) and reconnects */
    async reconnect(): Promise<void> {
        for (let i = 0; i < 40; i++) {
            try {
                await this.attach();
                return;
            } catch {
                await new Promise(r => setTimeout(r, 3000));
            }
        }
        throw new Error(`${this.serial} did not come back`);
    }

    private connect(url: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(url);
            this.ws.onopen = () => { this.connected = true; resolve(); };
            this.ws.onerror = e => reject(new Error(`DevTools connection failed: ${String((e as ErrorEvent).message ?? e)}`));
            this.ws.onclose = () => {
                this.connected = false;
                for (const [id, waiter] of this.pending) {
                    this.pending.delete(id);
                    waiter.reject(new ConnectionLost('DevTools connection closed'));
                }
            };
            this.ws.onmessage = ev => {
                const msg = JSON.parse(String(ev.data));
                const waiter = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
                if (!waiter) return;
                this.pending.delete(msg.id);
                if (msg.error) waiter.reject(new Error(msg.error.message));
                else if (msg.result?.exceptionDetails) waiter.reject(new Error(msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text));
                else waiter.resolve(msg.result?.result?.value);
            };
        });
    }

    /** Evaluates an expression in the page (promises awaited), returning its JSON value */
    evaluate<T = unknown>(expression: string, timeoutMs = 600_000): Promise<T> {
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout after ${timeoutMs} ms`)); }, timeoutMs);
            this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
            this.ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
        });
    }

    /** window.__aimmEval[method](...args); repeated once after a dropped connection */
    async call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
        const expression = `window.__aimmEval.${method}(...${JSON.stringify(args)})`;
        for (let attempt = 0; ; attempt++) {
            if (!this.connected) await this.reconnect();
            try {
                return await this.evaluate<T>(expression);
            } catch (e) {
                if (!(e instanceof ConnectionLost) || attempt > 0) throw e;
                console.log(`[device] ${this.serial}: connection lost during ${method}, reconnecting`);
            }
        }
    }

    close(): void {
        this.ws?.close();
        try { execFileSync('adb', ['-s', this.serial, 'forward', '--remove', `tcp:${this.port}`]); } catch { /* already gone */ }
    }
}

/** Android thermal status of the phone (0 none … 3 severe, 4 critical); -1 when unreadable */
export function thermalStatus(serial: string): number {
    try {
        const out = execFileSync('adb', ['-s', serial, 'shell', 'dumpsys', 'thermalservice'], { encoding: 'utf8' });
        const m = /Thermal Status:\s*(\d+)/.exec(out);
        return m ? Number(m[1]) : -1;
    } catch {
        return -1;
    }
}

/**
 * Before each scenario: a phone that got hot (status ≥ 3, severe) waits until it is back to
 * moderate (≤ 2; charging on USB it hardly goes lower). An hour of NPU generations brought the
 * Fold7 to critical (47 °C skin).
 */
export async function waitUntilCool(serial: string): Promise<void> {
    if (thermalStatus(serial) < 3) return;
    console.log(`[device] ${serial} is hot: pausing until it cools down`);
    while (thermalStatus(serial) > 2) await new Promise(r => setTimeout(r, 30_000));
    console.log(`[device] ${serial} cooled down`);
}
