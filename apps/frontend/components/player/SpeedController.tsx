// SSOT Phase 045 §6.1 — SpeedController (0.5x–2.5x, pitch-preserved)
// Canonical: apps/frontend/components/player/SpeedController.tsx
// (legacy src/frontend/components/player/SpeedController.tsx)
// - Applies playbackRate instantly + preservesPitch guard (BDD pitch audit).
// - Presentational: the player owns state, this owns the UI + DOM binding.
// - Zero new deps.
'use client';

import { PlaybackSpeedEnum, type PlaybackSpeed } from '@repo/shared';

interface SpeedControllerProps {
  speed: PlaybackSpeed;
  onChange: (speed: PlaybackSpeed) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export const PLAYBACK_SPEEDS: PlaybackSpeed[] = [...PlaybackSpeedEnum.options];

/** Bind rate + pitch guard to the media element (BDD §10 audit point). */
export function applyPlaybackSpeed(video: HTMLVideoElement | null, speed: PlaybackSpeed): void {
  if (!video) return;
  video.playbackRate = parseFloat(speed);
  const guarded = video as HTMLVideoElement & { preservesPitch?: boolean };
  if ('preservesPitch' in video) {
    try {
      guarded.preservesPitch = true;
    } catch {
      // Legacy engines ignore the hint — rate still applies.
    }
  }
}

export function SpeedController({ speed, onChange, videoRef }: SpeedControllerProps) {
  return (
    <select
      value={speed}
      onChange={(e) => {
        const next = e.target.value as PlaybackSpeed;
        onChange(next);
        applyPlaybackSpeed(videoRef.current, next);
      }}
      className="rounded border border-gray-700 bg-black/60 px-2 py-1 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
      aria-label="Playback speed"
    >
      {PLAYBACK_SPEEDS.map((s) => (
        <option key={s} value={s}>
          {s}x
        </option>
      ))}
    </select>
  );
}

export default SpeedController;
