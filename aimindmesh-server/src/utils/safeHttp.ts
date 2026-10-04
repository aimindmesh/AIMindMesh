/**
 * safeHttp.ts — outgoing GET requests to URLs chosen by a model or a web page.
 *
 * Only public http(s) addresses: a page read by an agent can ask it to fetch
 * http://10.x / localhost URLs (SearXNG, admin APIs, the VPN), i.e. server-side request
 * forgery. Every hop is checked: the URL, each redirect, and the IP the hostname resolves
 * to at connection time (so DNS rebinding cannot swap in a private address).
 */

import axios from 'axios';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const blocked = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

/** Loopback, private, link-local, CGNAT, multicast and reserved addresses (IPv4-mapped IPv6 included). */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '');
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) return blocked.check(ip, 'ipv6');
  return false;
}

/** Throws unless the URL is http(s) to a public host (literal IPs checked here, names at connect time). */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || isPrivateAddress(host)) {
    throw new Error('Local and private network addresses are not allowed');
  }
  return url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

/** dns.lookup that refuses names resolving to a private address. */
export function publicOnlyLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as dns.LookupAddress[];
    const privateHit = list.find(a => isPrivateAddress(a.address));
    if (privateHit || list.length === 0) {
      return callback(Object.assign(new Error(`${hostname} resolves to a private address`), { code: 'EPRIVATE' }));
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

const httpAgent = new http.Agent({ lookup: publicOnlyLookup as any });
const httpsAgent = new https.Agent({ lookup: publicOnlyLookup as any });

export interface PublicResponse {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

export interface PublicGetOptions {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
}

/** GET a public URL (redirects followed and re-checked, size and time bounded). */
export async function getPublicUrl(raw: string, options: PublicGetOptions = {}): Promise<PublicResponse> {
  const url = assertPublicUrl(raw);
  const response = await axios.get<ArrayBuffer>(url.toString(), {
    responseType: 'arraybuffer',
    timeout: options.timeoutMs ?? 20000,
    maxContentLength: options.maxBytes ?? 5 * 1024 * 1024,
    maxRedirects: 5,
    proxy: false, // a proxy would resolve the name itself, past the lookup check
    httpAgent,
    httpsAgent,
    headers: options.headers,
    // Redirects to literal IPs skip the DNS lookup: check them here
    beforeRedirect: (redirect: Record<string, any>) => {
      assertPublicUrl(`${redirect.protocol}//${redirect.hostname}${redirect.port ? `:${redirect.port}` : ''}/`);
    },
    validateStatus: () => true,
  });
  const finalUrl = (response.request as any)?.res?.responseUrl || url.toString();
  return {
    url: finalUrl,
    status: response.status,
    contentType: String(response.headers['content-type'] || '').toLowerCase(),
    body: Buffer.from(response.data),
  };
}
