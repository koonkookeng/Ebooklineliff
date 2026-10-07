// SSOT Phase 028 §2.2 — HLS security fallback UI (ERROR state)
// Canonical: apps/frontend/components/player/HlsSecurityFallback.tsx
// - Rendered ONLY when the host player reports a CSP/CORS media block
//   (reason !== null); otherwise returns null (zero RAM/touch cost, §9).
// - Thai copy per §2.2 ERROR row; dep-free (no new UI lib in the LIFF bundle).
// - Hosts mount: <HlsSecurityFallback reason={mediaError?.blockedBy} onRetry={retry} />
//   where blockedBy is 'CSP' | 'CORS' | 'ORIGIN' (x-csp-* / HLS.js error detail).
'use client';

export type HlsBlockReason = 'CSP' | 'CORS' | 'ORIGIN';

interface HlsSecurityFallbackProps {
  reason: HlsBlockReason | null;
  onRetry?: () => void;
}

const COPY: Record<HlsBlockReason, { title: string; body: string }> = {
  CSP: {
    title: 'การเชื่อมต่อไม่ปลอดภัย',
    body: 'เบราว์เซอร์บล็อกการโหลดสื่อตามนโยบายความปลอดภัย (CSP) กรุณาลองโหลดใหม่อีกครั้ง',
  },
  CORS: {
    title: 'โดนระงับการเข้าถึงสื่อ',
    body: 'เซิร์ฟเวอร์สื่อปฏิเสธคำขอข้ามโดเมน (CORS) กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่',
  },
  ORIGIN: {
    title: 'โดเมนไม่ได้รับอนุญาต',
    body: 'ลิงก์นี้ไม่ได้เปิดจากช่องทาง LINE ที่ได้รับอนุญาต กรุณาเปิดผ่านแอป LINE อีกครั้ง',
  },
};

export function HlsSecurityFallback({ reason, onRetry }: HlsSecurityFallbackProps) {
  if (!reason) return null;
  const copy = COPY[reason];
  return (
    <div
      role="alert"
      data-testid="hls-security-fallback"
      data-reason={reason}
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center"
    >
      <p className="text-base font-semibold text-white">{copy.title}</p>
      <p className="max-w-xs text-sm text-white/70">{copy.body}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          ลองโหลดใหม่
        </button>
      ) : null}
    </div>
  );
}

export default HlsSecurityFallback;
