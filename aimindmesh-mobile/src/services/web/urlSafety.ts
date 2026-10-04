/**
 * Which URLs the web tools may fetch: public http(s) pages only. A page could otherwise make
 * the model read the phone's local network (router, VPN, the AIMindMesh server) through a
 * link it planted.
 */

function isPrivateIPv4(host: string): boolean {
    const parts = host.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false;
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127
        || (a === 100 && b >= 64 && b <= 127)   // carrier-grade NAT
        || (a === 169 && b === 254)             // link-local
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || a >= 224;                            // multicast, reserved
}

function isPrivateIPv6(host: string): boolean {
    const h = host.replace(/^\[|\]$/g, '').toLowerCase();
    if (!h.includes(':')) return false;
    if (h === '::' || h === '::1') return true;
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIPv4(mapped[1]);
    return /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('ff');
}

/** Error message when the URL must not be fetched, null when it is a public http(s) URL. */
export function checkPublicHttpUrl(raw: string): string | null {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return 'Invalid URL: it must start with http:// or https://';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return 'Only http:// and https:// URLs can be read';
    }
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
        || (!host.includes('.') && !host.includes(':')) // single-label LAN names
        || isPrivateIPv4(host) || isPrivateIPv6(host)) {
        return 'Local and private network addresses cannot be read';
    }
    return null;
}
