import { withUser, fail, ok } from '@/lib/api';

export const POST = withUser(async ({ request }) => {
  const { googleAccessToken, maxItemCount = 200 } = await request.json();
  if (!googleAccessToken) return fail(400, 'A temporary Google Photos access token is required.');

  const response = await fetch('https://photospicker.googleapis.com/v1/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${googleAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pickingConfig: { maxItemCount: String(Math.min(2000, maxItemCount)) } }),
  });
  const payload = await response.json();
  if (!response.ok) return fail(response.status, payload?.error?.message || 'Google Photos session failed.');
  return ok({ session: payload });
});

export const GET = withUser(async ({ request }) => {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  const googleAccessToken = request.headers.get('x-google-access-token');
  if (!sessionId || !googleAccessToken) return fail(400, 'sessionId and Google access token are required.');

  const response = await fetch(`https://photospicker.googleapis.com/v1/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${googleAccessToken}` },
  });
  const payload = await response.json();
  if (!response.ok) return fail(response.status, payload?.error?.message || 'Google Photos session check failed.');
  return ok({ session: payload });
});
