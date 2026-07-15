import { NextResponse } from 'next/server';
import { AuthedUser, requireUser, UnauthorizedError } from './supabase';

/**
 * Wrap a route handler so that:
 *  - It runs only after a valid Bearer token resolves to a Supabase user.
 *  - It receives `{ user, request }` where `user.client` is already scoped
 *    to that user's JWT (so RLS policies apply).
 *  - `UnauthorizedError` is converted to a 401 JSON response.
 *  - Any thrown error is converted to a 500 JSON response with the message.
 *
 * Use for any mutation that should be tied to a specific user. Read-only
 * routes that need to act across all users (system jobs, MCP) should
 * stay unwrapped.
 *
 * Example:
 *   export const POST = withUser(async ({ user, request }) => {
 *     const { data } = await user.client.from('garments').insert({ user_id: user.id, ... });
 *     return NextResponse.json({ success: true, data });
 *   });
 */
export function withUser<T = unknown>(
  handler: (args: { user: AuthedUser; request: Request }) => Promise<Response>
) {
  return async (request: Request): Promise<Response> => {
    try {
      const user = await requireUser(request);
      return await handler({ user, request });
    } catch (err: any) {
      if (err instanceof UnauthorizedError) {
        return fail(401, 'Unauthorized');
      }
      console.error(`API error in ${handler.name || 'handler'}:`, err);
      return fail(500, err?.message || 'Internal server error');
    }
  };
}

/**
 * Shape every JSON response consistently. Avoids the `return { error }`
 * vs `{ success, error }` vs `{ items }` inconsistency across the codebase.
 */
export function ok<T>(data: T, init?: ResponseInit): Response {
  return NextResponse.json({ success: true, data }, init);
}

export function fail(status: number, error: string, extra?: Record<string, unknown>): Response {
  return NextResponse.json({ success: false, error, ...(extra || {}) }, { status });
}