// SSOT Phase 055 §3.1 — low-bandwidth delivery + network telemetry contracts
// Canonical: packages/shared/src/schemas/low-bandwidth-contract.ts
// (legacy src/shared/schemas/low-bandwidth-contract.ts)
// - Verbatim shapes from §3.1 (+ policy helpers shared by the NestJS chunk
//   gateway, the edge worker, and the LIFF adaptive reader/player).
// - Budgets: first-frame <1.5s, next-page <0.8s, RAM <28–30MB, toast-free
//   slim progress, Brotli q11 on SLOW_2G/GOOD_3G else q6, toast 500KB.
// - String-only mapping helpers (no node:crypto) so browser code can import.
import { z } from 'zod';

export const NetworkQualityTierEnum = z.enum(['OFFLINE', 'SLOW_2G', 'GOOD_3G', 'FAST_4G_5G']);
export type NetworkQualityTier = z.infer<typeof NetworkQualityTierEnum>;

export const ClientNetworkTelemetrySchema = z.object({
  downlinkMbps: z.number().nonnegative(),
  rttMs: z.number().int().nonnegative(),
  effectiveType: NetworkQualityTierEnum,
  packetLossRate: z.number().min(0).max(1),
  effectiveRamMb: z.number().positive(),
});

export const LowBandwidthChunkRequestSchema = z.object({
  productId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  networkQuality: NetworkQualityTierEnum,
  compressFormat: z.enum(['BROTLI', 'GZIP', 'RAW_SVG']).default('BROTLI'),
  enableWatermark: z.boolean().default(true),
});

export const LowBandwidthChunkResponseSchema = z.object({
  pageNumber: z.number().int().positive(),
  compressedPayloadBase64: z.string(),
  byteLength: z.number().int().positive(),
  isLowBandwidthMode: z.boolean(),
  forensicWatermarkHash: z.string(),
  checksumSha256: z.string(),
});

export type ClientNetworkTelemetry = z.infer<typeof ClientNetworkTelemetrySchema>;
export type LowBandwidthChunkRequest = z.infer<typeof LowBandwidthChunkRequestSchema>;
export type LowBandwidthChunkResponse = z.infer<typeof LowBandwidthChunkResponseSchema>;

// ---------- §1.3/§2.1 budgets + adaptation policy (single source) ----------
export const LOW_NET_FIRST_FRAME_MS = 1500;
export const LOW_NET_NEXT_PAGE_MS = 800;
export const LOW_NET_RAM_CAP_MB = 28;
export const LOW_NET_BROTLI_Q_SLOW = 11;
export const LOW_NET_BROTLI_Q_FAST = 6;
export const LOW_NET_CHUNK_CACHE_TTL_SEC = 86400;
export const LOW_NET_RTT_SLOW_MS = 300;
export const LOW_NET_DOWNLINK_SLOW_MBPS = 1.5;

/** Sliding prefetch window: full [N-1,N,N+1] on fast nets, [N,N+1] when slow. */
export function prefetchWindow(page: number, tier: NetworkQualityTier): number[] {
  if (tier === 'OFFLINE' || tier === 'SLOW_2G' || tier === 'GOOD_3G') {
    return [page, page + 1];
  }
  return [page - 1, page, page + 1].filter((p) => p >= 1);
}

/** Map a navigator.connection effectiveType to the telemetry tier. */
export function tierFromEffectiveType(effectiveType: string | undefined, downlinkMbps: number): NetworkQualityTier {
  if (!effectiveType) return downlinkMbps < LOW_NET_DOWNLINK_SLOW_MBPS ? 'GOOD_3G' : 'FAST_4G_5G';
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return 'SLOW_2G';
  if (effectiveType === '3g') return 'GOOD_3G';
  return 'FAST_4G_5G';
}

/** Brotli quality ladder (§5.1): max ratio on slow links, speed on fast. */
export function brotliQualityFor(tier: NetworkQualityTier): number {
  return tier === 'SLOW_2G' || tier === 'GOOD_3G' ? LOW_NET_BROTLI_Q_SLOW : LOW_NET_BROTLI_Q_FAST;
}

/** True when the link qualifies for degraded delivery (badge + 360p + trim). */
export function isLowBandwidthTier(tier: NetworkQualityTier): boolean {
  return tier === 'SLOW_2G' || tier === 'GOOD_3G';
}

// ---------- §1.3 Scenario-2 variant ladder policy (single source) ----------
/** Sustained-bitrate budget per tier (kbps); ladder entries above it are cut. */
export const TIER_BITRATE_BUDGET_KBPS: Record<NetworkQualityTier, number> = {
  OFFLINE: 0,
  SLOW_2G: 400,
  GOOD_3G: 800,
  FAST_4G_5G: Number.POSITIVE_INFINITY,
};

export interface HlsLadderVariant {
  label: string;
  url: string;
  bitrateKbps: number;
}

/** Keep affordable variants; always retain the lowest rung (never strand). */
export function filterVariantsByBudget(variants: HlsLadderVariant[], tier: NetworkQualityTier): HlsLadderVariant[] {
  if (variants.length === 0) return [];
  const budget = TIER_BITRATE_BUDGET_KBPS[tier];
  const affordable = variants.filter((v) => v.bitrateKbps <= budget);
  if (affordable.length > 0) return affordable;
  return [[...variants].sort((a, b) => a.bitrateKbps - b.bitrateKbps)[0]];
}
