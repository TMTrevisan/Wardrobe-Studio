import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';

export const GET = withUser(async ({ user }) => {
  const { data: measurements, error } = await user.client
    .from('user_measurements')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return fail(500, error.message);
  return ok({ measurements });
});

export const POST = withUser(async ({ user, request }) => {
  const body = await request.json();
  const { label, measurement_type, details } = body;

  if (!label || !measurement_type) return fail(400, 'Label and type are required.');

  const { data: measurement, error } = await user.client
    .from('user_measurements')
    .insert([{ user_id: user.id, label, measurement_type, details: details || {} }])
    .select()
    .single();

  if (error) return fail(500, error.message);
  return ok({ measurement });
});

export const DELETE = withUser(async ({ user, request }) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) return fail(400, 'ID is required.');

  const { error } = await user.client
    .from('user_measurements')
    .delete()
    .eq('id', id);

  if (error) return fail(500, error.message);
  return ok({});
});