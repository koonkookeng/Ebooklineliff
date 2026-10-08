// SSOT Phase 055 Task 4 — network-aware HLS manifest trim (low-bitrate fallback)
// Canonical: apps/backend/src/modules/stream/hls-manifest.service.ts
// (legacy src/backend/modules/stream/hls-manifest.service.ts)
// - Trims the variant ladder to what the link can sustain (360p/400kbps
//   floor on degraded links, §1.3 Scenario 2: 1080p → 360p within 1 cycle).
// - Rewrites media URIs with the short-lived segment token (zero egress).
// - Constructor takes ports — no Nest param decorators (tsx-importable).
import { Injectable } from '@nestjs/common';
import {
  filterVariantsByBudget,
  hlsSignedSegmentUrl,
  type HlsLadderVariant,
  type NetworkQualityTier,
} from '@repo/shared';

export { TIER_BITRATE_BUDGET_KBPS } from '@repo/shared';

export interface HlsVariant extends HlsLadderVariant {}

export interface ManifestR2Port {
  getObjectText(objectKey: string): Promise<string>;
}

@Injectable()
export class HlsManifestService {
  constructor(private readonly r2?: ManifestR2Port) {}

  /** Keep affordable variants; always retain the lowest rung (never strand). */
  filterVariantsForTier(variants: HlsVariant[], tier: NetworkQualityTier): HlsVariant[] {
    return filterVariantsByBudget(variants, tier);
  }

  /** Append the short-lived token to every media/variant URI in a playlist. */
  rewritePlaylistUrls(masterM3u8: string, token: string): string {
    return masterM3u8
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          return line.startsWith('#EXT-X-KEY')
            ? line.replace(/URI="[^"]*"/, `URI="${hlsSignedSegmentUrl('key', token)}"`)
            : line;
        }
        return hlsSignedSegmentUrl(trimmed, token);
      })
      .join('\n');
  }

  /** Fetch → trim → sign: one call serves the degraded manifest. */
  async getManifestForTier(
    objectKey: string,
    variants: HlsVariant[],
    tier: NetworkQualityTier,
    token: string,
  ): Promise<{ playlist: string; servedVariants: HlsVariant[] }> {
    if (!this.r2) throw new Error('MANIFEST_STORE_UNAVAILABLE');
    const raw = await this.r2.getObjectText(objectKey);
    const servedVariants = this.filterVariantsForTier(variants, tier);
    const allowed = new Set(servedVariants.map((v) => v.url.split('/').pop()));
    const trimmed = raw
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return true;
        // Only variant-playlist rungs are tier-gated; media segments (.ts),
        // keys, and maps always pass through (else playback stalls).
        if (!t.endsWith('.m3u8')) return true;
        if (allowed.size === 0) return true;
        return allowed.has(t.split('/').pop() ?? '');
      })
      .join('\n');
    return { playlist: this.rewritePlaylistUrls(trimmed, token), servedVariants };
  }
}
