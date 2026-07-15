import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';

// GET all wear logs (to compute CPW client-side)
export const GET = withUser(async ({ user }) => {
  const { data: logs, error } = await user.client
    .from('wear_logs')
    .select('id, garment_id, worn_at');

  if (error) return fail(500, error.message);
  return ok({ logs });
});

// POST log a garment as worn
export const POST = withUser(async ({ user, request }) => {
  const { garment_id } = await request.json();

  if (!garment_id) return fail(400, 'garment_id is required.');

  // Verify the garment belongs to this user before logging the wear.
  // Without this, a caller could inflate someone else's CPW.
  const { data: garment, error: garmentErr } = await user.client
    .from('garments')
    .select('id')
    .eq('id', garment_id)
    .single();

  if (garmentErr || !garment) return fail(404, 'Garment not found.');

  const { data: log, error } = await user.client
    .from('wear_logs')
    .insert([
      {
        garment_id,
        user_id: user.id,
      },
    ])
    .select()
    .single();

  if (error) return fail(500, error.message);
  return ok({ log });
});