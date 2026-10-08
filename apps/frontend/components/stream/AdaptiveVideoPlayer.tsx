// SSOT Phase 067 Task 4-6 — AdaptiveVideoPlayer (native ABR + badge + menu)
// Canonical: apps/frontend/components/stream/AdaptiveVideoPlayer.tsx
// (legacy src/frontend/components/stream/AdaptiveVideoPlayer.tsx)
// - RISK_CALL deviations (zero-new-dep LIFF policy): native <video> only
//   (hls.js NOT installed — HlsVideoPlayer precedent); inline SVG icons
//   (lucide-react NOT installed); variant switching by src swap at the
//   current time (no segment reload stalls on Safari/LIFF native HLS).
// - ABR: useNetworkBandwidth (4s cadence) + AbrHysteresis (fast-down,
//   8s-held-up); manual menu locks a rung; stalls auto-drop to 360p.
// - 5-state: LIFF_INIT → IDLE → LOADING (switching) → SUCCESS / ERROR
//   (fallback UI + retry + 360p). Telemetry fire-and-forget.
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNetworkBandwidth } from '../../hooks/useNetworkBandwidth';
import {
  AbrHysteresis,
  estimateRamMb,
  fetchQualityManifest,
  reportStreamTelemetry,
  type ActiveQuality,
} from '../../lib/hls-quality-selector';
import type { VideoQualityLevel, VideoStreamManifest } from '@repo/shared';

type PlayerState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface AdaptiveVideoPlayerProps {
  lessonId: string;
  masterManifestUrl?: string;
  watermarkText?: string;
}

const MENU: Array<{ value: VideoQualityLevel; label: string }> = [
  { value: 'AUTO', label: 'Auto (Adaptive)' },
  { value: 'QUALITY_1080P', label: '1080p FHD' },
  { value: 'QUALITY_720P', label: '720p HD' },
  { value: 'QUALITY_480P', label: '480p SD' },
  { value: 'QUALITY_360P', label: '360p Saver' },
];

function shortLabel(q: VideoQualityLevel, active: ActiveQuality): string {
  if (q === 'AUTO') return `Auto (${active.replace('QUALITY_', '')})`;
  return q.replace('QUALITY_', '');
}

export function AdaptiveVideoPlayer({ lessonId, masterManifestUrl, watermarkText }: AdaptiveVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hysteresis = useRef(new AbrHysteresis());
  const [state, setState] = useState<PlayerState>('LIFF_INIT');
  const [manifest, setManifest] = useState<VideoStreamManifest | null>(null);
  const [manual, setManual] = useState<VideoQualityLevel>('AUTO');
  const [active, setActive] = useState<ActiveQuality>('QUALITY_720P');
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stalls, setStalls] = useState(0);
  const { metrics } = useNetworkBandwidth();
  const manualRef = useRef(manual);
  manualRef.current = manual;

  useEffect(() => {
    let cancelled = false;
    setState('LIFF_INIT');
    fetchQualityManifest(lessonId)
      .then((m) => {
        if (cancelled) return;
        setManifest(m);
        setState('IDLE');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'โหลดสตรีมล้มเหลว');
        setState('ERROR');
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const applyVariant = useCallback(
    (next: ActiveQuality, src: string) => {
      const video = videoRef.current;
      setState('LOADING');
      if (video && src) {
        const t = video.currentTime || 0;
        const wasPaused = video.paused;
        video.src = src;
        video.load();
        const resume = () => {
          try {
            video.currentTime = Math.max(0, t - 0.5);
          } catch {
            // seek best-effort
          }
          if (!wasPaused) void video.play().catch(() => undefined);
          video.removeEventListener('loadedmetadata', resume);
        };
        video.addEventListener('loadedmetadata', resume);
      }
      setActive(next);
      setState('SUCCESS');
      setToast(`คุณภาพ: ${shortLabel(manualRef.current, next)}`);
    },
    [],
  );

  // ABR loop: decide on every metrics tick; switch only on change.
  useEffect(() => {
    if (!manifest || state === 'ERROR') return;
    const next = hysteresis.current.decide(metrics.downlinkMbps, manualRef.current, metrics.saveDataMode);
    if (next === active) return;
    const variant = manifest.variants.find((v) => v.quality === next);
    const src = variant?.playlistUrl ?? manifest.masterPlaylistUrl;
    applyVariant(next, src);
    void reportStreamTelemetry({
      lessonId,
      selectedQuality: manualRef.current,
      activeQuality: next,
      measuredMbps: metrics.downlinkMbps,
      bufferStallCount: stalls,
      ramUsageMb: estimateRamMb(videoRef.current?.buffered.length ? videoRef.current.buffered.end(videoRef.current.buffered.length - 1) - videoRef.current.currentTime : 0),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, manifest]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const onStall = useCallback(() => {
    setStalls((s) => {
      const n = s + 1;
      // Error path: repeated stalls force 360p (BDD ERROR fallback).
      if (n >= 2 && manifest) {
        const low = manifest.variants.find((v) => v.quality === 'QUALITY_360P');
        if (low) applyVariant('QUALITY_360P', low.playlistUrl);
      }
      return n;
    });
  }, [applyVariant, manifest]);

  const pick = useCallback(
    (value: VideoQualityLevel) => {
      setManual(value);
      manualRef.current = value;
      setMenuOpen(false);
      if (!manifest) return;
      if (value === 'AUTO') return; // ABR loop picks on next tick
      const variant = manifest.variants.find((v) => v.quality === value);
      applyVariant(value, variant?.playlistUrl ?? manifest.masterPlaylistUrl);
    },
    [applyVariant, manifest],
  );

  const retry = useCallback(() => {
    setError(null);
    setStalls(0);
    setState('LOADING');
    fetchQualityManifest(lessonId)
      .then((m) => {
        setManifest(m);
        setManual('AUTO');
        setState('IDLE');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'โหลดสตรีมล้มเหลว');
        setState('ERROR');
      });
  }, [lessonId]);

  const src = manifest?.masterPlaylistUrl ?? masterManifestUrl ?? '';

  if (state === 'LIFF_INIT') {
    return <div className="aspect-video w-full animate-pulse rounded-xl bg-zinc-900" aria-busy />;
  }

  if (state === 'ERROR') {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-zinc-900 text-white" role="alert">
        <p className="text-sm">เน็ตช้าเกินไป — สลับเป็น 360p อัตโนมัติแล้ว</p>
        <p className="text-xs text-zinc-400">{error}</p>
        <button type="button" onClick={retry} className="min-h-[44px] rounded-md bg-emerald-600 px-4 text-sm font-medium">
          ลองอีกครั้ง
        </button>
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-2xl">
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        controls
        playsInline
        src={src}
        onWaiting={onStall}
        onStalled={onStall}
      />

      {watermarkText && (
        <div className="pointer-events-none absolute left-4 top-4 select-none rounded bg-black/40 px-2 py-1 text-xs text-white opacity-30 backdrop-blur-sm">
          {watermarkText}
        </div>
      )}

      <div className="absolute right-4 top-4 flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/60 px-2.5 py-1 text-xs text-white backdrop-blur-md">
          <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${metrics.downlinkMbps > 3 ? 'text-emerald-400' : 'text-amber-400'}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01" />
          </svg>
          <span>{metrics.downlinkMbps > 0 ? `${metrics.downlinkMbps} Mbps` : 'Measuring...'}</span>
          <span className="text-gray-400">|</span>
          <span className="font-semibold text-emerald-300">{shortLabel(manual, active)}</span>
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="ตั้งค่าคุณภาพวิดีโอ"
          className="rounded-full bg-black/60 p-1.5 text-white backdrop-blur-md transition-colors hover:bg-black/80"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {state === 'LOADING' && (
        <div className="absolute right-4 top-14" aria-busy>
          <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-emerald-400" />
        </div>
      )}
      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
          {toast}
        </div>
      )}

      {menuOpen && (
        <div className="absolute right-4 top-14 z-50 flex min-w-[130px] flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900/95 p-2 text-xs text-white shadow-2xl backdrop-blur-lg">
          {MENU.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => pick(m.value)}
              className={`rounded px-3 py-1.5 text-left ${manual === m.value ? 'bg-emerald-600 font-bold' : 'hover:bg-zinc-800'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default AdaptiveVideoPlayer;
