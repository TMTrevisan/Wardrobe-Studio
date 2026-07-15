import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';

/**
 * Returns aggregate telemetry for the current user.
 *
 * Defensive against schema drift: the billing_and_token_ledger
 * table may not have `user_id` or `timestamp` columns yet (it was
 * added by hand in production). Tries the richest query first and
 * falls back progressively to a plain `select *`.
 */
export const GET = withUser(async ({ user }) => {
  // Try (1) filtered + ordered, (2) filtered, (3) unfiltered.
  let ledger: any[] | null = null;
  let lastError: string | null = null;

  for (const query of [
    () =>
      user.client
        .from('billing_and_token_ledger')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(500),
    () =>
      user.client
        .from('billing_and_token_ledger')
        .select('*')
        .eq('user_id', user.id)
        .limit(500),
    () => user.client.from('billing_and_token_ledger').select('*').limit(500),
  ]) {
    const { data, error } = await query();
    if (!error) {
      ledger = (data as any[]) ?? [];
      break;
    }
    lastError = error.message;
  }

  if (ledger === null) {
    return fail(500, lastError ?? 'Could not read billing_and_token_ledger.');
  }

  // Aggregate.
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCost = 0;

  const serviceStats: Record<string, { count: number; totalLatency: number; totalCost: number }> = {};

  for (const entry of ledger) {
    totalTokensIn += entry.tokens_in || 0;
    totalTokensOut += entry.tokens_out || 0;
    totalCost += Number(entry.estimated_cost || 0);

    const service = entry.service;
    if (!serviceStats[service]) {
      serviceStats[service] = { count: 0, totalLatency: 0, totalCost: 0 };
    }
    serviceStats[service].count += 1;
    serviceStats[service].totalLatency += entry.latency_ms || 100;
    serviceStats[service].totalCost += Number(entry.estimated_cost || 0);
  }

  const services = Object.keys(serviceStats).map((key) => ({
    service: key,
    count: serviceStats[key].count,
    avgLatencyMs: Math.round(serviceStats[key].totalLatency / serviceStats[key].count),
    totalCost: Number(serviceStats[key].totalCost.toFixed(6)),
  }));

  return ok({
    stats: {
      totalTokensIn,
      totalTokensOut,
      totalCost: Number(totalCost.toFixed(6)),
      services,
    },
    recentLogs: ledger,
  });
});