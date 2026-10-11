// SSOT Phase 127 §2 — maintenance / DR failover page (5-state, offline-first)
// Canonical: apps/frontend/app/(liff)/maintenance/page.tsx
// (legacy src/frontend/app/(liff)/maintenance/page.tsx)
// - LIFF_INIT (splash) -> IDLE (healthy) / DR_FAILOVER_MODE (Lightweight
//   Read-Only from IndexedDB cache) / ERROR (unreachable + retry).
// - Never white-screens: cached ebook pages stay readable during failover
//   (BDD-2: no lost reading progress). Text-only, <30MB. Zero new deps.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';

type MaintenanceState = 'LIFF_INIT' | 'IDLE' | 'DR_FAILOVER_MODE' | 'LOADING' | 'ERROR';

interface CachedPage {
  productId: string;
  pageNumber: number;
  title?: string;
}

async function readCachedPages(): Promise<CachedPage[]> {
  if (typeof indexedDB === 'undefined') return [];
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open('offline-chunk-cache', 1);
      open.onerror = () => resolve([]);
      open.onsuccess = () => {
        try {
          const db = open.result;
          if (!db.objectStoreNames.contains('chunks')) {
            db.close();
            resolve([]);
            return;
          }
          const tx = db.transaction('chunks', 'readonly');
          const req = tx.objectStore('chunks').getAllKeys();
          req.onsuccess = () => {
            const keys = (req.result as unknown[]) ?? [];
            db.close();
            resolve(
              keys.slice(0, 20).map((k, i) => ({
                productId: String(k).split(':')[0] ?? String(k),
                pageNumber: i + 1,
              })),
            );
          };
          req.onerror = () => {
            db.close();
            resolve([]);
          };
        } catch {
          resolve([]);
        }
      };
      open.onupgradeneeded = () => {
        try {
          open.result.close();
        } catch {
          /* noop */
        }
        resolve([]);
      };
    } catch {
      resolve([]);
    }
  });
}

function MaintenanceInner() {
  const [state, setState] = useState<MaintenanceState>('LIFF_INIT');
  const [cached, setCached] = useState<CachedPage[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);

  const check = useCallback(async () => {
    setState((s) => (s === 'LIFF_INIT' ? s : 'LOADING'));
    let healthy = false;
    try {
      const res = await fetch('/api/v1/infra/health', { cache: 'no-store' });
      healthy = res.ok;
    } catch {
      healthy = false;
    }
    const pages = await readCachedPages();
    setCached(pages);
    if (healthy) {
      setState('IDLE');
    } else if (pages.length > 0 || typeof indexedDB !== 'undefined') {
      setState('DR_FAILOVER_MODE');
    } else {
      setState('ERROR');
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(check, 400);
    return () => clearTimeout(t);
  }, [check, retryNonce]);

  useEffect(() => {
    const onOnline = () => setRetryNonce((n) => n + 1);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  if (state === 'LIFF_INIT' || state === 'LOADING') {
    return (
      <main aria-busy="true" style={{ padding: 24 }}>
        <p>กำลังตรวจสอบสถานะระบบ…</p>
      </main>
    );
  }

  if (state === 'ERROR') {
    return (
      <main style={{ padding: 24 }}>
        <h1>เชื่อมต่อระบบไม่ได้</h1>
        <p>กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง ความคืบหน้าการอ่านของคุณถูกเก็บไว้ในเครื่องแล้ว</p>
        <button type="button" onClick={() => setRetryNonce((n) => n + 1)} style={{ minHeight: 44 }}>
          ลองอีกครั้ง
        </button>
      </main>
    );
  }

  if (state === 'DR_FAILOVER_MODE') {
    return (
      <main style={{ padding: 24 }}>
        <p role="status">กำลังอัปเดตระบบความปลอดภัยเรียลไทม์</p>
        <h1>โหมดอ่านออฟไลน์</h1>
        <p>คุณยังอ่านหน้าที่บันทึกไว้ในเครื่องได้ตามปกติ ความคืบหน้าไม่สูญหาย</p>
        {cached.length === 0 ? (
          <p>ยังไม่มีหน้าที่แคชไว้ — กลับมาอ่านต่อเมื่อระบบกลับมาปกติ</p>
        ) : (
          <ul>
            {cached.map((p) => (
              <li key={`${p.productId}-${p.pageNumber}`}>
                <a href={`/reader/${encodeURIComponent(p.productId)}?page=${p.pageNumber}`}>
                  อ่านต่อหน้า {p.pageNumber}
                </a>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => setRetryNonce((n) => n + 1)} style={{ minHeight: 44 }}>
          ตรวจสอบสถานะอีกครั้ง
        </button>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>ระบบพร้อมใช้งาน</h1>
      <p>ไม่พบเหตุขัดข้อง กลับไปอ่านต่อได้เลย</p>
      <a href="/library">กลับไปห้องสมุดของฉัน</a>
    </main>
  );
}

export default function MaintenancePage() {
  return (
    <Suspense fallback={<main style={{ padding: 24 }}><p>กำลังโหลด…</p></main>}>
      <MaintenanceInner />
    </Suspense>
  );
}
