// SSOT Phase 125 Task 3 §8.2 — Cloudflare edge fetch balancer (failover)
// Canonical: apps/backend/src/infra/edge/cloudflare-balancer.ts
// (legacy src/infra/edge/cloudflare-balancer.ts)
// - Walks the failover chain with a per-attempt timeout (BDD-2: 500ms
//   trip → 200ms reroute); 5xx/timeout marks the region bad for the
//   remainder of the walk. Emits infra alerts best-effort (Gate 8) and
//   never throws without trying every node.
// - Zero new deps (global fetch only).
import { Injectable, Logger } from '@nestjs/common';
import { EDGE_FAILOVER_BUDGET_MS, EDGE_UNHEALTHY_AFTER_MS, INFRA_ALERT_STREAM, type EdgeNode } from '@repo/shared';
import { planEdgeRoute } from './load-balancer';

/** Minimal stream surface for failover alerts (structural). */
export interface BalancerStreamPort {
  xaddPipeline(streamKey: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(url, init),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('EDGE_UPSTREAM_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

@Injectable()
export class CloudflareBalancer {
  private readonly logger = new Logger(CloudflareBalancer.name);

  constructor(private readonly stream?: BalancerStreamPort) {}

  /**
   * GET through the failover chain (first 2xx wins; regions that 5xx or
   * time out are skipped downstream). Throws the last error when all
   * nodes fail.
   */
  async fetchEdge(
    countryCode: string,
    nodes: EdgeNode[],
    path: string,
    init: RequestInit = {},
    attemptTimeoutMs = EDGE_UNHEALTHY_AFTER_MS,
  ): Promise<{ res: Response; region: string; attempts: number }> {
    const plan = planEdgeRoute(countryCode, nodes);
    const bad = new Set<string>();
    let lastError: unknown = new Error('EDGE_NO_NODES');
    let attempts = 0;
    const deadline = Date.now() + EDGE_FAILOVER_BUDGET_MS + attemptTimeoutMs * Math.max(1, plan.failover.length);
    for (const node of plan.failover) {
      if (bad.has(node.region)) continue;
      if (Date.now() > deadline) break;
      attempts++;
      try {
        const res = await fetchWithTimeout(`${node.url}${path}`, init, attemptTimeoutMs);
        if (res.status >= 500) throw new Error(`EDGE_UPSTREAM_${res.status}`);
        return { res, region: node.region, attempts };
      } catch (err) {
        lastError = err;
        bad.add(node.region);
        this.logger.warn(`Edge node ${node.region} routed around: ${(err as Error).message}`);
        try {
          await this.stream?.xaddPipeline(INFRA_ALERT_STREAM, [
            { event: 'edge.failover', region: node.region, path, at: Date.now() },
          ]);
        } catch {
          // Telemetry never breaks the walk.
        }
      }
    }
    throw lastError;
  }
}
