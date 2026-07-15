import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertPublicHttpsUrl } from './url-safety';

// Mock node:dns/promises so the tests don't actually hit the network.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => {
    // Pretend anything containing "private" or "loopback" resolves to a
    // private IP; pretend everything else resolves to a public one.
    if (host.startsWith('private') || host.includes('localhost')) {
      return { address: '10.0.0.1', family: 4 };
    }
    return { address: '93.184.216.34', family: 4 }; // example.com
  }),
}));

describe('assertPublicHttpsUrl()', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('accepts a public HTTPS URL', async () => {
    const url = await assertPublicHttpsUrl('https://example.com/x.jpg');
    expect(url.hostname).toBe('example.com');
  });

  it('rejects http:// (non-HTTPS)', async () => {
    await expect(assertPublicHttpsUrl('http://example.com/x.jpg')).rejects.toThrow(/HTTPS/i);
  });

  it('rejects javascript: and other non-https schemes', async () => {
    await expect(assertPublicHttpsUrl('javascript:alert(1)')).rejects.toThrow();
    await expect(assertPublicHttpsUrl('file:///etc/passwd')).rejects.toThrow();
  });

  it('rejects loopback hostnames', async () => {
    await expect(assertPublicHttpsUrl('https://localhost/x')).rejects.toThrow(/loopback/i);
    await expect(assertPublicHttpsUrl('https://api.localhost/x')).rejects.toThrow(/loopback/i);
  });

  it('rejects hostnames that resolve to private IPs', async () => {
    await expect(assertPublicHttpsUrl('https://privatehost.example/x')).rejects.toThrow(
      /private/i
    );
  });

  it('rejects literal RFC1918 IPv4 addresses', async () => {
    await expect(assertPublicHttpsUrl('https://10.0.0.1/x')).rejects.toThrow(/private/i);
    await expect(assertPublicHttpsUrl('https://192.168.1.1/x')).rejects.toThrow(/private/i);
    await expect(assertPublicHttpsUrl('https://172.16.0.1/x')).rejects.toThrow(/private/i);
  });

  it('rejects the AWS/GCP metadata endpoint 169.254.169.254', async () => {
    await expect(assertPublicHttpsUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /private/i
    );
  });

  it('rejects loopback IPv4 (127.0.0.0/8)', async () => {
    await expect(assertPublicHttpsUrl('https://127.0.0.1/x')).rejects.toThrow(/private/i);
  });

  it('rejects loopback IPv6 (::1)', async () => {
    await expect(assertPublicHttpsUrl('https://[::1]/x')).rejects.toThrow(/private|IPv6/i);
  });

  it('rejects malformed URLs', async () => {
    await expect(assertPublicHttpsUrl('not a url')).rejects.toThrow();
    await expect(assertPublicHttpsUrl('')).rejects.toThrow();
  });
});