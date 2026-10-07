// SSOT Phase 039 Task 39.1 — Redis Edge cluster infrastructure config
// Canonical: apps/backend/src/infra/redis/redis-cluster.config.ts
// (legacy src/infra/redis/redis-cluster.config.ts)
// - Pure factory (zero new deps): resolves single-node Edge options from
//   REDIS_EDGE_HOST/PORT/PASSWORD with REDIS_CLUSTER_NODES fallback.
// - Defaults mirror §5.2: connectTimeout 5000, maxRetriesPerRequest 3,
//   24h sliding TTL. Tenant isolation enforced at key level (§2.1).
import { CHUNK_CACHE_TTL_SEC } from '@repo/shared';

export interface RedisEdgeNodeOptions {
  host: string;
  port: number;
}

export interface RedisEdgeConfig {
  nodes: RedisEdgeNodeOptions[];
  password?: string;
  connectTimeoutMs: number;
  maxRetriesPerRequest: number;
  keyPrefix: string;
  defaultTtlSec: number;
  enableReadyCheck: boolean;
}

export const REDIS_EDGE_DEFAULTS = {
  host: 'localhost',
  port: 6379,
  connectTimeoutMs: 5000,
  maxRetriesPerRequest: 3,
  defaultTtlSec: CHUNK_CACHE_TTL_SEC,
  enableReadyCheck: true,
} as const;

function parseClusterNodes(raw: string): RedisEdgeNodeOptions[] {
  const nodes = raw
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((node) => {
      const [host, portRaw] = node.split(':');
      return { host: host || REDIS_EDGE_DEFAULTS.host, port: Number(portRaw) || REDIS_EDGE_DEFAULTS.port };
    })
    .filter((n) => n.host.length > 0 && Number.isFinite(n.port) && n.port > 0);
  return nodes;
}

/** Resolve Edge config from env (pure — no I/O, fully unit-testable). */
export function resolveRedisEdgeConfig(env: NodeJS.ProcessEnv = process.env): RedisEdgeConfig {
  const clusterRaw = env.REDIS_CLUSTER_NODES?.trim();
  const nodes = clusterRaw
    ? parseClusterNodes(clusterRaw)
    : [
        {
          host: env.REDIS_EDGE_HOST?.trim() || REDIS_EDGE_DEFAULTS.host,
          port: Number(env.REDIS_EDGE_PORT) || REDIS_EDGE_DEFAULTS.port,
        },
      ];
  return {
    nodes: nodes.length > 0 ? nodes : [{ host: REDIS_EDGE_DEFAULTS.host, port: REDIS_EDGE_DEFAULTS.port }],
    password: env.REDIS_EDGE_PASSWORD || env.REDIS_PASSWORD || undefined,
    connectTimeoutMs: Number(env.REDIS_EDGE_CONNECT_TIMEOUT_MS) || REDIS_EDGE_DEFAULTS.connectTimeoutMs,
    maxRetriesPerRequest: REDIS_EDGE_DEFAULTS.maxRetriesPerRequest,
    keyPrefix: 'tenant:',
    defaultTtlSec: REDIS_EDGE_DEFAULTS.defaultTtlSec,
    enableReadyCheck: REDIS_EDGE_DEFAULTS.enableReadyCheck,
  };
}

/** Guard: every chunk key must carry the tenant prefix (§2.1 isolation). */
export function isTenantIsolatedKey(key: string): boolean {
  return key.startsWith('tenant:') && key.includes(':ebook:') && key.endsWith(':chunk');
}
