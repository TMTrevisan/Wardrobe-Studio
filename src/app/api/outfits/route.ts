import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';

export const GET = withUser(async ({ user }) => {
  const { data: outfits, error } = await user.client
    .from('saved_outfits')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return fail(500, error.message);
  return ok({ outfits });
});

export const POST = withUser(async ({ user, request }) => {
  const { name, item_ids, styling_reasoning } = await request.json();

  if (!name || !item_ids || !Array.isArray(item_ids)) {
    return fail(400, 'Name and item_ids array are required.');
  }

  const { data: outfit, error } = await user.client
    .from('saved_outfits')
    .insert([
      {
        user_id: user.id,
        name,
        item_ids,
        styling_reasoning: styling_reasoning || null,
      },
    ])
    .select()
    .single();

  if (error) return fail(500, error.message);
  return ok({ outfit });
});

export const DELETE = withUser(async ({ user, request }) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) return fail(400, 'Outfit ID is required.');

  const { error } = await user.client
    .from('saved_outfits')
    .delete()
    .eq('id', id);

  if (error) return fail(500, error.message);
  return ok({});
});