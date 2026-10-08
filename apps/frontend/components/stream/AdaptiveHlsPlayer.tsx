// SSOT Phase 055 §1.3 Scenario-2 — adaptive HLS player (tier-capped ladder)
// Canonical: apps/frontend/components/stream/AdaptiveHlsPlayer.tsx
// (legacy src/frontend/components/stream/AdaptiveHlsPlayer.tsx)
// - Wraps the stream/ engine (single playback implementation, §9): on slow
//   links the variant ladder is pre-filtered by the shared budget policy so
//   the player settles on 360p/400kbps within one segment cycle — no spinner,
//   no stall. Progress sync passes through untouched.
// - Badge mirrors the reader shell. Zero new deps.
'use client';

import { useMemo } from 'react';
import { HlsVideoPlayer as StreamPlayer } from './HlsVideoPlayer';
import { useNetworkQuality } from '../../hooks/useNetworkQuality';
import { filterVariantsByBudget, isLowBandwidthTier } from '@repo/shared';

interface AdaptiveHlsPlayerProps {
  masterManifestUrl: string;
  securityToken: string;
  watermarkText: string;
  onProgressSync: (watchedSec: number, isCompleted?: boolean) => void;
  variants?: Array<{ label: string; url: string; bitrateKbps: number }>;
  posterUrl?: string;
  autoPlay?: boolean;
  initialTime?: number;
  durationSec?: number;
}

export function AdaptiveHlsPlayer({
  masterManifestUrl,
  securityToken,
  watermarkText,
  onProgressSync,
  variants = [],
  posterUrl,
  autoPlay = false,
  initialTime = 0,
  durationSec = 0,
}: AdaptiveHlsPlayerProps) {
  const { tier } = useNetworkQuality();
  const capped = useMemo(() => filterVariantsByBudget(variants, tier), [variants, tier]);
  const degraded = isLowBandwidthTier(tier);

  return (
    <div className="relative">
      {degraded && (
        <span className="absolute right-2 top-2 z-40 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300" role="status">
          3G Mode: 360p Optimized
        </span>
      )}
      <StreamPlayer
        masterManifestUrl={masterManifestUrl}
        securityToken={securityToken}
        watermarkText={watermarkText}
        onProgressSync={onProgressSync}
        variants={capped.map(({ label, url }) => ({ label, url }))}
        posterUrl={posterUrl}
        autoPlay={autoPlay}
        initialTime={initialTime}
        durationSec={durationSec}
      />
    </div>
  );
}

export default AdaptiveHlsPlayer;
