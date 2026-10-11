// SSOT Phase 121 Task 6 §7.1 — Prometheus metrics service (zero-dep)
// Canonical: apps/backend/src/infra/observability/metrics.service.ts
// (legacy src/backend/infra/observability/metrics.service.ts)
// - In-memory counters + duration histograms with Prometheus text
//   exposition for /metrics (spec §7.1 trio: http_request_duration_seconds,
//   slip_verification_latency_seconds, liff_canvas_ram_usage_bytes).
//   A real prom-client registry swaps behind record()/expose() without
//   touching callers (documented seam — no new dep in repo).
// - Bounded cardinality: tenant label only (route labels allow-listed).
// - Zero new deps.
import { Injectable } from '@nestjs/common';

const MAX_SLOTS = 4096;

export interface HistogramPoint {
  count: number;
  sum: number;
}

function quantiles(values: number[], qs: number[]): Record<string, number> {
  if (values.length === 0) {
    const out: Record<string, number> = {};
    for (const q of qs) out[`p${q * 100}`] = 0;
    return out;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const out: Record<string, number> = {};
  for (const q of qs) {
    out[`p${q * 100}`] = sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;
  }
  return out;
}

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, number[]>();

  /** Monotonic counter (drops when the slot cap trips, returns false). */
  increment(name: string, labels: Record<string, string> = {}, by = 1): boolean {
    const key = `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`;
    if (!this.counters.has(key) && this.counters.size >= MAX_SLOTS) return false;
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
    return true;
  }

  /** Duration observation in seconds (spec trio use seconds). */
  observe(name: string, seconds: number, labels: Record<string, string> = {}): boolean {
    const key = `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`;
    const arr = this.durations.get(key);
    if (!arr && this.durations.size >= MAX_SLOTS) return false;
    if (arr) {
      arr.push(seconds);
      if (arr.length > 1024) arr.splice(0, arr.length - 1024);
    } else {
      this.durations.set(key, [seconds]);
    }
    return true;
  }

  observeHttpRequest(tenantId: string, seconds: number): boolean {
    return this.observe('http_request_duration_seconds', seconds, { tenant: tenantId });
  }

  observeSlipVerification(seconds: number, tenantId = 'default'): boolean {
    return this.observe('slip_verification_latency_seconds', seconds, { tenant: tenantId });
  }

  observeCanvasRam(bytes: number, tenantId = 'default'): boolean {
    this.increment('liff_canvas_ram_observations_total', { tenant: tenantId });
    return this.observe('liff_canvas_ram_usage_bytes', bytes, { tenant: tenantId });
  }

  /** Phase 122 §7: circuit transition ledger (external_api_circuit_breaker_state). */
  observeCircuitTransition(serviceName: string, from: string, to: string): boolean {
    return this.increment('external_api_circuit_breaker_state', { service: serviceName, from, to });
  }

  snapshot(): { counters: Record<string, number>; histograms: Record<string, HistogramPoint & { p50: number; p95: number; p99: number }> } {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) counters[k] = v;
    const histograms: Record<string, HistogramPoint & { p50: number; p95: number; p99: number }> = {};
    for (const [k, arr] of this.durations) {
      const count = arr.length;
      const sum = arr.reduce((s, v) => s + v, 0);
      const q = quantiles(arr, [0.5, 0.95, 0.99]);
      histograms[k] = { count, sum, p50: q['p50'] ?? 0, p95: q['p95'] ?? 0, p99: q['p99'] ?? 0 };
    }
    return { counters, histograms };
  }

  /** Prometheus text exposition for the /metrics scrape lane. */
  expose(): string {
    const lines: string[] = [];
    for (const [k, v] of this.counters) lines.push(`${k} ${v}`);
    for (const [k, arr] of this.durations) {
      const count = arr.length;
      const sum = arr.reduce((s, v) => s + v, 0);
      lines.push(`${k}_count ${count}`);
      lines.push(`${k}_sum ${sum}`);
    }
    return `${lines.join('\n')}\n`;
  }

  /** Test seam: reset all series. */
  resetForTests(): void {
    this.counters.clear();
    this.durations.clear();
  }
}
