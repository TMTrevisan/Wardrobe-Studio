import { describe, it, expect, vi } from 'vitest';
import { ok, fail, withUser } from './api';
import { UnauthorizedError } from './supabase';

// Stub out the supabase module so withUser() can be tested in isolation
// without touching the network. `vi.mock` is hoisted, so this file picks
// up the mock at import time.
vi.mock('./supabase', async () => {
  const actual = await vi.importActual<typeof import('./supabase')>('./supabase');
  return {
    ...actual,
    requireUser: vi.fn(),
  };
});

// Import after the mock is registered so requireUser() inside withUser
// resolves to the stub.
import { requireUser } from './supabase';
const requireUserMock = vi.mocked(requireUser);

function makeRequest(token: string | null = 'valid-token'): Request {
  const headers: Record<string, string> = {};
  if (token) headers['authorization'] = `Bearer ${token}`;
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers,
  });
}

describe('ok()', () => {
  it('wraps data in { success: true, data }', async () => {
    const res = ok({ items: [1, 2, 3] });
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { items: [1, 2, 3] } });
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('forwards init.status when provided', async () => {
    const res = ok({ x: 1 }, { status: 201 });
    expect(res.status).toBe(201);
  });
});

describe('fail()', () => {
  it('returns { success: false, error } with status', async () => {
    const res = fail(404, 'Not found');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Not found' });
  });

  it('merges extra fields', async () => {
    const res = fail(422, 'Invalid', { field: 'email' });
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'Invalid', field: 'email' });
  });
});

describe('withUser()', () => {
  it('passes through the resolved user to the handler', async () => {
    requireUserMock.mockResolvedValueOnce({
      id: 'user-1',
      email: 'a@b.com',
      client: {} as any,
    });

    const handler = vi.fn(async () => ok({ ok: true }));
    const wrapped = withUser(handler as any);
    const res = await wrapped(makeRequest('valid-token'));

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    const call = (handler.mock.calls[0] as any)?.[0] as { user: { id: string }; request: Request };
    expect(call.user.id).toBe('user-1');
    expect(call.request).toBeDefined();
  });

  it('returns 401 on UnauthorizedError', async () => {
    requireUserMock.mockRejectedValueOnce(new UnauthorizedError());

    const handler = vi.fn();
    const wrapped = withUser(handler as any);
    const res = await wrapped(makeRequest('bad-token'));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Unauthorized' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 500 on generic thrown error', async () => {
    requireUserMock.mockResolvedValueOnce({
      id: 'user-1',
      email: 'a@b.com',
      client: {} as any,
    });

    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    const wrapped = withUser(handler as any);
    const res = await wrapped(makeRequest('valid-token'));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'boom' });
  });
});