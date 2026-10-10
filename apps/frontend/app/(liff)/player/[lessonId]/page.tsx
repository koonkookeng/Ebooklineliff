// SSOT Phase 119 Tasks 5-6 §2.2 — secure LIFF lesson player shell
// Canonical: apps/frontend/app/(liff)/player/[lessonId]/page.tsx
// - LIFF_INIT (fingerprint collect) -> IDLE (bound, ticket ready) ->
//   LOADING (handshake/key) -> SUCCESS (HLS + 5s heartbeat + forensic
//   overlay userIdHash/timestamp) -> ERROR (eviction modal / fraud lock).
//   The lesson video URL arrives via ?src= (lesson catalogue lanes own
//   content resolution — this shell owns session security only).
// - Zero new deps.
'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { collectDeviceFingerprint } from '@/lib/fingerprint/fingerprint-collector';
import { deviceSessionApi, subscribeEvictions, type DeviceSessionState } from '@/lib/fingerprint/device-session-client';
import { DeviceEvictionModal } from '@/components/security/device-eviction-modal';

function SecurePlayerInner() {
  const params = useParams<{ lessonId: string }>();
  const query = useSearchParams();
  const tenant = query.get('tenant') ?? 'default';
  const src = query.get('src') ?? '';
  const lessonId = params.lessonId;
  const [state, setState] = useState<DeviceSessionState>('LIFF_INIT');
  const [fingerprint, setFingerprint] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [ticket, setTicket] = useState('');
  const [evicted, setEvicted] = useState<string | undefined>(undefined);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const start = useCallback(async () => {
    setState('LOADING');
    setError(null);
    try {
      const sig = await collectDeviceFingerprint();
      setFingerprint(sig.fingerprintHash);
      const api = deviceSessionApi(tenant);
      const hs = await api.handshake({
        fingerprint: {
          canvasHash: sig.canvasHash,
          webglHash: sig.webglHash,
          audioHash: sig.audioHash,
          screenResolution: `${window.screen.width}x${window.screen.height}`,
          userAgent: navigator.userAgent,
          deviceType: 'WEB_MOBILE_BROWSER',
        },
        lessonId,
      });
      setSessionToken(hs.sessionToken);
      const key = await api.streamKey(hs.sessionToken, lessonId);
      setTicket(key.ticket);
      setState('IDLE');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'เริ่มเล่นไม่สำเร็จ';
      setError(message);
      if (message.includes('locked') || message.includes('OTP')) setLocked(true);
      setState('ERROR');
    }
  }, [tenant, lessonId]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    if ((state !== 'IDLE' && state !== 'SUCCESS') || !sessionToken || !fingerprint) return;
    const api = deviceSessionApi(tenant);
    const timer = setInterval(() => {
      const pos = Math.floor(videoRef.current?.currentTime ?? position);
      setPosition(pos);
      void api
        .heartbeat({ lessonId, sessionToken, fingerprintHash: fingerprint, playbackPositionSec: pos })
        .then((r) => {
          if (r.takenOver && r.evictedDeviceId) setEvicted(r.evictedDeviceId);
        })
        .catch((e: Error) => {
          if (/evict|concurrent|locked|mismatch/i.test(e.message)) {
            setEvicted(undefined);
            setState('ERROR');
          }
        });
    }, 5000);
    const off = subscribeEvictions(sessionToken, (d) => setEvicted(d.evictedDeviceId));
    return () => {
      clearInterval(timer);
      off();
    };
  }, [state, sessionToken, fingerprint, tenant, lessonId, position]);

  useEffect(() => {
    if (evicted) videoRef.current?.pause();
  }, [evicted]);

  async function kickOther() {
    setBusy(true);
    try {
      await deviceSessionApi(tenant).evictOther();
      setEvicted(undefined);
      await start();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เตะไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'LIFF_INIT' || state === 'LOADING') {
    return <p>กําลังตรวจสอบความปลอดภัยอุปกรณ์…</p>;
  }

  return (
    <div>
      {src ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video ref={videoRef} src={src} controls style={{ width: '100%' }} data-testid="secure-player" />
      ) : (
        <p>ไม่พบแหล่งวิดีโอ (?src=)</p>
      )}
      <div aria-hidden data-testid="forensic-overlay" style={{ opacity: 0.15 }}>
        {fingerprint.slice(0, 12)} · {new Date().toISOString().slice(0, 10)}
      </div>
      {state === 'IDLE' && (
        <button
          type="button"
          data-testid="play-button"
          onClick={() => {
            void videoRef.current?.play().catch(() => undefined);
            setState('SUCCESS');
          }}
        >
          เล่นวิดีโอ
        </button>
      )}
      <p data-testid="playback-ticket" hidden>
        {ticket}
      </p>
      {state === 'ERROR' && !evicted && (
        <p role="alert">
          {locked ? 'บัญชีถูกล็อกชั่วคราว — ยืนยัน OTP เพื่อปลดล็อก' : (error ?? 'เกิดข้อผิดพลาด')}{' '}
          <button type="button" onClick={() => void start()}>
            ลองใหม่
          </button>
        </p>
      )}
      {evicted !== undefined && (
        <DeviceEvictionModal
          evictedDeviceId={evicted}
          busy={busy}
          error={error}
          onKickOther={kickOther}
          onRequestOtp={() => setLocked(true)}
          onClose={() => setEvicted(undefined)}
        />
      )}
    </div>
  );
}

export default function SecurePlayerPage() {
  return (
    <Suspense fallback={<p>กําลังตรวจสอบความปลอดภัยอุปกรณ์…</p>}>
      <SecurePlayerInner />
    </Suspense>
  );
}
