// SSOT Phase 130 §2.2 — 5-state production UI gate (LIFF + Web)
// Canonical: apps/frontend/components/go-live/ProductionStateGate.tsx
// - PRODUCTION_BOOT (branded splash + warm-up probe) -> LIVE_IDLE /
//   DEGRADED_PERF (lightweight banner: previews + live chat suppressed) /
//   CIRCUIT_OPEN (local slip fallback queue) / CRITICAL_ERROR (maintenance +
//   LINE OA support). State derivation is SSOT-pure
//   (productionUiStateFromHealth), so tests do not need a React renderer.
// - Polls only while visible (15s) and aborts in-flight fetches on unmount:
//   no timers/requests survive navigation (LIFF < 30MB, no leak).
// - Zero new deps (inline SVG, no icon package).
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { productionUiStateFromHealth, type ProductionUiState } from '@repo/shared';

const POLL_MS = 15_000;
const PROBE_TIMEOUT_MS = 5_000;
const SLIP_QUEUE_KEY = 'golive:slip-fallback-queue';
const SUPPORT_URL = process.env.NEXT_PUBLIC_LINE_OA_URL ?? 'https://line.me/R/ti/p/@omnichannel';

interface ReadinessEnvelope {
  status: 'HEALTHY' | 'DEGRADED' | 'MAINTENANCE' | 'CRITICAL_FAILURE';
}

/** Pure: readiness payload + HTTP reachability -> UI state. */
export function resolveProductionUiState(payload: unknown, reachable: boolean): ProductionUiState {
  if (!reachable || !payload || typeof payload !== 'object') return 'CRITICAL_ERROR';
  const status = (payload as { status?: unknown }).status;
  if (typeof status !== 'string') return 'CRITICAL_ERROR';
  return productionUiStateFromHealth({ status } as ReadinessEnvelope);
}

function SupportIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3a8.5 8.5 0 00-3.2 16.4c.4.1.5-.2.5-.4v-1.5c-2.4.5-2.9-1.1-2.9-1.1-.4-1-.9-1.2-.9-1.2-.8-.5.1-.5.1-.5.8.1 1.3.9 1.3.9.8 1.3 2 .9 2.5.7.1-.6.3-1 .6-1.2-1.9-.2-3.9-1-3.9-4.3 0-1 .3-1.7.9-2.3-.1-.2-.4-1.1.1-2.3 0 0 .7-.2 2.4.9a8.2 8.2 0 014.3 0c1.7-1.1 2.4-.9 2.4-.9.5 1.2.2 2.1.1 2.3.6.6.9 1.4.9 2.3 0 3.3-2 4.1-3.9 4.3.3.3.6.8.6 1.7v2.5c0 .2.1.5.5.4A8.5 8.5 0 0012 3z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ProductionStateGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ProductionUiState>('PRODUCTION_BOOT');
  const [queuedAt, setQueuedAt] = useState<string | null>(null);
  const mounted = useRef(true);

  const probe = useCallback(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch('/api/v1/infra/golive', { cache: 'no-store', signal: controller.signal });
      const data = await res.json().catch(() => null);
      if (mounted.current) setState(resolveProductionUiState(data, res.ok));
    } catch {
      if (mounted.current) setState('CRITICAL_ERROR');
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void probe();
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void probe();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void probe();
    };
    // Payment/external-service outages can trip the circuit without failing
    // the DB probe; payment surfaces dispatch this event on 5xx/timeout.
    const onCircuit = () => setState('CIRCUIT_OPEN');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('golive:circuit-open', onCircuit);
    return () => {
      mounted.current = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('golive:circuit-open', onCircuit);
    };
  }, [probe]);

  const queueSlip = useCallback(() => {
    const at = new Date().toISOString();
    try {
      localStorage.setItem(SLIP_QUEUE_KEY, JSON.stringify({ queuedAt: at }));
    } catch {
      /* storage may be blocked in private LIFF webviews; UI still confirms */
    }
    setQueuedAt(at);
  }, []);

  if (state === 'PRODUCTION_BOOT') {
    return (
      <div
        data-production-state={state}
        role="status"
        aria-busy="true"
        style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}
      >
        <div>
          <div
            aria-hidden="true"
            style={{
              width: 36,
              height: 36,
              margin: '0 auto 12px',
              borderRadius: '50%',
              border: '4px solid var(--primary-color, #06c755)',
              borderTopColor: 'transparent',
            }}
          />
          <p>กำลังเปิดระบบและตรวจสอบความพร้อม…</p>
        </div>
      </div>
    );
  }

  if (state === 'CRITICAL_ERROR') {
    return (
      <main data-production-state={state} role="alert" style={{ padding: 24, textAlign: 'center' }}>
        <h1>ระบบอยู่ระหว่างซ่อมบำรุง</h1>
        <p>ไม่สามารถเชื่อมต่อฐานข้อมูลหลักได้ในขณะนี้ ทีมวิศวกรได้รับแจ้งเตือนแล้ว</p>
        <p style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
          <SupportIcon />
          <a href={SUPPORT_URL} rel="noopener noreferrer" target="_blank">
            ติดต่อ LINE OA Support
          </a>
        </p>
        <button
          type="button"
          onClick={() => {
            setState('PRODUCTION_BOOT');
            void probe();
          }}
          style={{ padding: '10px 16px', borderRadius: 8, background: 'var(--primary-color, #06c755)', color: '#fff' }}
        >
          ลองอีกครั้ง
        </button>
      </main>
    );
  }

  return (
    <div data-production-state={state}>
      {state === 'DEGRADED_PERF' && (
        <p role="status" style={{ margin: 0, padding: '8px 12px', background: '#fff7e6', color: '#7a4b00' }}>
          ระบบทำงานด้วยโหมดประหยัด (ปิดภาพพรีวิว/Live Chat ชั่วคราว) — การอ่านและชำระเงินยังใช้งานได้ปกติ
        </p>
      )}
      {state === 'CIRCUIT_OPEN' && (
        <section role="alert" style={{ padding: 16, background: '#fff1f0', color: '#7a1f1f' }}>
          <strong>ระบบตรวจสลิปอัตโนมัติกำลังปรับปรุงชั่วคราว</strong>
          <p>ท่านสามารถบันทึกสลิปไว้ให้ทีมงานตรวจสอบย้อนหลังได้ทันที สิทธิ์จะเปิดอัตโนมัติเมื่อระบบกลับมา</p>
          <button
            type="button"
            onClick={queueSlip}
            style={{ padding: '10px 16px', borderRadius: 8, background: 'var(--primary-color, #06c755)', color: '#fff' }}
          >
            บันทึกสลิปไว้ตรวจสอบย้อนหลัง
          </button>
          {queuedAt && <p role="status">บันทึกสลิปเข้าคิวแล้วเมื่อ {new Date(queuedAt).toLocaleString('th-TH')}</p>}
        </section>
      )}
      {children}
    </div>
  );
}

export default ProductionStateGate;
