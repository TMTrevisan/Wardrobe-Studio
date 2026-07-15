/**
 * URL safety guard for server-side `fetch()` calls.
 *
 * Background: any time we let a user supply a URL that the server then
 * fetches (image ingestion, manufacturer image replace, MCP `image_url`),
 * we open an SSRF vector. An attacker can point at internal services,
 * cloud metadata endpoints (169.254.169.254), or localhost. This module
 * pins the URL to HTTPS and rejects hostnames that resolve into private
 * or link-local IP space.
 *
 * Usage:
 *   const safe = await assertPublicHttpsUrl(rawUrl);
 *   const res  = await fetch(safe);
 */

const PRIVATE_IPV4_RANGES = [
  /^10\./,                         // 10.0.0.0/8
  /^192\.168\./,                   // 192.168.0.0/16
  /^172\.(1[6-9]|2\d|3[01])\./,    // 172.16.0.0/12
  /^127\./,                        // 127.0.0.0/8 (loopback)
  /^169\.254\./,                   // 169.254.0.0/16 (link-local + AWS/GCP/Azure metadata)
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./, // 100.64.0.0/10 (CGN)
  /^0\./,                          // 0.0.0.0/8
  /^224\./,                        // 224.0.0.0/4 (multicast)
  /^240\./,                        // 240.0.0.0/4 (reserved)
];

const PRIVATE_IPV6_PREFIXES = [
  '::1',           // loopback
  'fc',            // fc00::/7 (ULA)
  'fd',            // fd00::/8 (ULA)
  'fe80',          // fe80::/10 (link-local)
];

function isPrivateIPv4(host: string): boolean {
  return PRIVATE_IPV4_RANGES.some((re) => re.test(host));
}

function isPrivateIPv6(host: string): boolean {
  // `new URL('https://[::1]/').hostname` returns `[::1]` with brackets.
  // Strip them, plus any IPv6 zone-id suffix (e.g. `fe80::1%eth0`).
  const normalized = host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .split('%')[0];
  return PRIVATE_IPV6_PREFIXES.some((p) => normalized.startsWith(p));
}

/**
 * Throws if `raw` is not a syntactically valid public HTTPS URL pointing
 * at a hostname that resolves (today) to a public IP. The DNS lookup is
 * best-effort: if it fails, we still reject obvious cases (localhost,
 * private literals) but allow the rest to fail naturally on `fetch()`.
 *
 * Why DNS at all? A hostname like `attacker-controlled.com` can resolve
 * to `127.0.0.1` via a DNS rebinding trick or a custom resolver. By
 * resolving at validation time and refusing private results, we close
 * the simplest versions of that attack.
 */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed.');
  }

  const host = url.hostname;

  // Literal-IP hosts: validate the IP itself.
  const literalIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (literalIPv4) {
    if (isPrivateIPv4(host)) {
      throw new Error(`Refusing to fetch private IP ${host}.`);
    }
  } else if (host.includes(':')) {
    // IPv6 literal
    if (isPrivateIPv6(host)) {
      throw new Error(`Refusing to fetch private IPv6 ${host}.`);
    }
  } else {
    // Hostname: quick textual checks first.
    const lowered = host.toLowerCase();
    if (
      lowered === 'localhost' ||
      lowered.endsWith('.localhost') ||
      lowered.endsWith('.local') ||
      lowered.endsWith('.internal')
    ) {
      throw new Error(`Refusing to fetch loopback host ${host}.`);
    }
    // Resolve and check the answer.
    try {
      // Use Node's `dns/promises` so this works in the Node runtime.
      // (Edge runtime support would require swapping for `dns-resolver`.)
      const { lookup } = await import('node:dns/promises');
      const { address } = await lookup(host);
      if (isPrivateIPv4(address) || isPrivateIPv6(address)) {
        throw new Error(`Refusing to fetch ${host} → private ${address}.`);
      }
    } catch (err: any) {
      // If we can't resolve, fail closed — better than letting an attacker
      // walk past the check by configuring a hostname that fails lookup
      // on *our* end but works on the actual `fetch()`.
      if (err?.code === 'ENOTFOUND' || err?.code === 'EAI_AGAIN') {
        throw new Error(`Cannot resolve hostname ${host}.`);
      }
      // Re-throw our own explicit refusals.
      if (err instanceof Error && err.message.startsWith('Refusing')) throw err;
      throw err;
    }
  }

  return url;
}

/**
 * Optional convenience: explicitly opt-in allowlist of host suffixes.
 * Use this if you only ever want to fetch from a known CDN set
 * (e.g. `*.cloudfront.net`, `*.supabase.co`).
 */
export async function assertPublicHttpsUrlAllowlisted(
  raw: string,
  allowedSuffixes: string[]
): Promise<URL> {
  const url = await assertPublicHttpsUrl(raw);
  const host = url.hostname.toLowerCase();
  if (!allowedSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    throw new Error(`Host ${host} is not in the allowlist.`);
  }
  return url;
}