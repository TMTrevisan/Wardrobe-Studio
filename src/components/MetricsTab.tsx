'use client';

import { useEffect } from 'react';
import type { TelemetryStats } from '@/types/db';
import PageHeader from './PageHeader';
import EmptyState from './EmptyState';

interface MetricsTabProps {
  telemetry: TelemetryStats | null;
  telemetryLogs: any[];
  loading: boolean;
  onRefresh: () => Promise<void> | void;
}

const SERVICE_LABELS: Record<string, string> = {
  Gemini_Vision_Ingest: '🔍 Vision Ingest',
  Gemini_Stylist_Engine: '💡 Stylist Engine',
  Pirate_Weather_API: '🌤 Weather',
  Gemini_Search_Image: '🖼 Image Search',
};

/**
 * Telemetry / cost-ledger view. Shows cumulative spend, per-service
 * breakdown, recent API calls. Pure presentation — fetching is done by
 * the parent so we keep state coherent across the rest of the app.
 */
export default function MetricsTab({
  telemetry,
  telemetryLogs,
  loading,
  onRefresh,
}: MetricsTabProps) {
  // Auto-refresh every 30s while the tab is mounted.
  useEffect(() => {
    const id = setInterval(() => onRefresh(), 30_000);
    return () => clearInterval(id);
  }, [onRefresh]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon="📊"
        title="System Telemetry & Cost Ledger"
        description="Real-time accounting of Gemini API consumption, token usage, and latency."
        badge={`$${telemetry?.totalCost?.toFixed(4) ?? '0'}`}
        actions={
          <button
            type="button"
            onClick={() => onRefresh()}
            disabled={loading}
            className="px-3 py-1.5 bg-[var(--accent-terracotta)] text-white text-[10px] font-extrabold uppercase tracking-wider rounded-full hover:bg-[var(--accent-terracotta)]/90 disabled:opacity-50 transition"
          >
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        }
      />

      {!telemetry ? (
        <div className="bg-[var(--bg-card-primary)] border border-[#EAE5D9] rounded-3xl p-6">
          <EmptyState
            icon="📡"
            title="Loading telemetry data…"
            description="If this persists, check that the billing_and_token_ledger table is reachable."
          />
        </div>
      ) : (
        <>
          {/* Top-line stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 bg-[var(--bg-card-primary)] border border-[#EAE5D9] rounded-2xl">
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">Cumulative cost</span>
              <p className="text-2xl font-black text-[var(--accent-terracotta)] font-mono mt-1">
                ${telemetry.totalCost.toFixed(4)}
              </p>
            </div>
            <div className="p-4 bg-[var(--bg-card-primary)] border border-[#EAE5D9] rounded-2xl">
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">Input tokens</span>
              <p className="text-2xl font-black font-mono mt-1">
                {telemetry.totalTokensIn.toLocaleString()}
              </p>
            </div>
            <div className="p-4 bg-[var(--bg-card-primary)] border border-[#EAE5D9] rounded-2xl">
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">Output tokens</span>
              <p className="text-2xl font-black font-mono mt-1">
                {telemetry.totalTokensOut.toLocaleString()}
              </p>
            </div>
            <div className="p-4 bg-[var(--bg-card-primary)] border border-[#EAE5D9] rounded-2xl">
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">API calls</span>
              <p className="text-2xl font-black font-mono mt-1">
                {telemetry.services.reduce((acc: number, s: any) => acc + (s.count || 0), 0)}
              </p>
            </div>
          </div>

          {/* Per-service breakdown */}
          <div className="bg-[var(--bg-card-primary)] border border-[#EAE5D9] rounded-3xl p-6 shadow-xl">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
              Cost by service
            </h3>
            <div className="space-y-2">
              {telemetry.services.length === 0 ? (
                <EmptyState
                  icon="📭"
                  title="No API calls yet"
                  description="As soon as you upload a garment or generate an outfit, this fills up."
                />
              ) : (
                telemetry.services.map((s: any) => {
                  const max = Math.max(...telemetry.services.map((x: any) => x.totalCost || 0));
                  const pct = max > 0 ? (s.totalCost / max) * 100 : 0;
                  return (
                    <div key={s.service} className="flex items-center gap-3">
                      <span className="w-44 text-[10px] font-bold text-[var(--text-primary)] truncate">
                        {SERVICE_LABELS[s.service] ?? s.service}
                      </span>
                      <div className="flex-1 h-2 bg-[var(--bg-card-secondary)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--accent-terracotta)] transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-32 text-right text-[10px] font-mono text-[var(--text-secondary)]">
                        ${s.totalCost.toFixed(6)} <span className="opacity-60">· {s.count}×</span>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Recent API log */}
          <div className="bg-[var(--bg-card-primary)] border border-[#EAE5D9] rounded-3xl p-6 shadow-xl">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
              Recent API calls
            </h3>
            {telemetryLogs.length === 0 ? (
              <EmptyState icon="🕓" title="No recent calls" description="Once you use Gemini, the latest 50 show here." />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#EAE5D9]">
                <table className="w-full text-[10px]">
                  <thead className="bg-[var(--bg-card-secondary)] text-[var(--text-secondary)]">
                    <tr>
                      <th className="text-left px-3 py-2 font-bold uppercase tracking-wider">When</th>
                      <th className="text-left px-3 py-2 font-bold uppercase tracking-wider">Service</th>
                      <th className="text-right px-3 py-2 font-bold uppercase tracking-wider">Tokens in</th>
                      <th className="text-right px-3 py-2 font-bold uppercase tracking-wider">Tokens out</th>
                      <th className="text-right px-3 py-2 font-bold uppercase tracking-wider">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {telemetryLogs.slice(0, 20).map((row: any) => (
                      <tr key={row.id ?? `${row.timestamp}-${row.service}`} className="border-t border-[#EAE5D9]">
                        <td className="px-3 py-1.5 font-mono text-[var(--text-secondary)]">
                          {row.timestamp ? new Date(row.timestamp).toLocaleString() : '—'}
                        </td>
                        <td className="px-3 py-1.5">{SERVICE_LABELS[row.service] ?? row.service}</td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {(row.tokens_in ?? 0).toLocaleString()}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {(row.tokens_out ?? 0).toLocaleString()}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-[var(--accent-terracotta)]">
                          ${(row.estimated_cost ?? 0).toFixed(6)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}