import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Use placeholder credentials during Next.js static build steps if environment variables are missing
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-url-for-build-steps.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key-build-step';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn('Supabase URL or Anon Key is missing in environment. Using placeholder configuration for build step compilation.');
}

/**
 * Service-role / admin client. Bypasses RLS. Only use this when a route
 * intentionally needs to act across all users (e.g., MCP system endpoint
 * with its own bearer token, scheduled jobs). For per-user mutations,
 * use `getSupabaseClient(request)` so RLS can do its job.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Build a Supabase client scoped to the caller's session (if they sent a
 * Bearer token). Without a token this falls back to the admin client,
 * which is why mutating routes MUST call `requireUser()` first.
 */
export function getSupabaseClient(request?: Request): SupabaseClient {
  if (!request) return supabase;

  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    return createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      // Forward the caller's session so RLS evaluates against their JWT.
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return supabase;
}

/**
 * Extract the bearer token from a request, if any.
 */
export function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

export type AuthedUser = {
  id: string;
  email: string | null;
  client: SupabaseClient;
};

/**
 * Resolve the authenticated user from the request's Bearer token.
 *
 * Returns `null` if the token is missing, malformed, or the user can't
 * be resolved. Routes that call this should treat `null` as 401.
 *
 * Implementation note: we use `supabase.auth.getUser(token)` rather than
 * relying on the request-scoped client because the request-scoped client
 * would otherwise make a network roundtrip per query. The token is
 * validated against the Supabase auth server exactly once per request.
 */
export async function getUserFromRequest(request: Request): Promise<AuthedUser | null> {
  const token = getBearerToken(request);
  if (!token) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return { id: data.user.id, email: data.user.email ?? null, client };
  } catch {
    return null;
  }
}

/**
 * Like `getUserFromRequest` but throws if no user is present. Use inside
 * a try/catch in a route handler, paired with a 401 response.
 */
export class UnauthorizedError extends Error {
  constructor() { super('Unauthorized'); }
}

export async function requireUser(request: Request): Promise<AuthedUser> {
  const user = await getUserFromRequest(request);
  if (!user) throw new UnauthorizedError();
  return user;
}