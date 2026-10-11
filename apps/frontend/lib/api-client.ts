// SSOT Phase 122 §6.1 — front-end HTTP resilience client (LIFF 5-state)
// Canonical: apps/frontend/lib/api-client.ts
// (legacy src/frontend/lib/api-client.ts)
// - RISK_CALL deviation (documented): fetch + crypto.randomUUID instead of
//   axios + uuid (zero-dep rule; no new packages in this repo). Same wire
//   behavior: POST/PUT auto-inject X-Idempotency-Key, 3x exponential
//   backoff with jitter on 503/network, Thai fallback copy per §2.1.
// - Memory guard: callers pass AbortSignal timeouts; no retained queues
//   (responses stream to the 5-state hook and release). SSR-safe.
// - Zero new deps.

/** §2.1 Thai fallback copy (never a raw error code on LIFF). */
export const RESILIENCE_FALLBACK_MESSAGES = {
  CIRCUIT_OPEN_EASYSLIP:
    'ระบบตรวจสลิปอัตโนมัติกำลังปรับปรุงชั่วคราว ทีมงานกำลังรับสลิปของท่านเข้าคิวตรวจสอบแบบเรียลไทม์ สินค้าดิจิทัลจะเปิดสิทธิ์ให้อัตโนมัติในทันที',
  IDEMPOTENT_REPLAY_ACTIVE: 'ทำรายการสำเร็จแล้ว ระบบกำลังนำท่านไปยังคลังหนังสือ/คอร์สเรียน...',
  CIRCUIT_OPEN_LINE_MSG:
    'การส่งข้อความยืนยันใน LINE แชตอาจล่าช้าเล็กน้อย ท่านสามารถตรวจสอบคำสั่งซื้อได้ทันทีในประวัติการสั่งซื้อ',
} as const;
export type ResilienceFallbackKey = keyof typeof RESILIENCE_FALLBACK_MESSAGES;

/** New idempotency key (IDEM-<ms>-<uuid>, always ≥16 chars). */
export function newIdempotencyKey(): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
  return `IDEM-${Date.now()}-${uuid}`;
}

export interface ResilientRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Max attempts (default 3; only 503/network retry). */
  maxRetries?: number;
  /** Base backoff in ms (default 500; jitter +200ms). */
  backoffBaseMs?: number;
  /** Per-attempt timeout in ms (default 5000). */
  timeoutMs?: number;
  /** Explicit idempotency key (auto-minted for POST/PUT when absent). */
  idempotencyKey?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resilient fetch: idempotency injection + 503/network retry.
 * Returns the raw Response (callers own the 5-state machine).
 */
export async function resilientFetch(path: string, options: ResilientRequestOptions = {}): Promise<Response> {
  const {
    method = 'GET',
    body,
    headers = {},
    maxRetries = 3,
    backoffBaseMs = 500,
    timeoutMs = 5000,
    idempotencyKey,
  } = options;
  const mutating = method === 'POST' || method === 'PUT' || method === 'PATCH';
  const key = mutating ? idempotencyKey ?? newIdempotencyKey() : idempotencyKey;
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const res = await fetch(path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
          ...(key ? { 'X-Idempotency-Key': key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status !== 503 || attempt > maxRetries) return res;
    } catch (err) {
      if (attempt > maxRetries) throw err;
      const aborted = err instanceof Error && err.name === 'TimeoutError';
      if (!aborted && !(err instanceof TypeError)) throw err;
    }
    const jitter = Math.random() * 200;
    await sleep(Math.pow(2, attempt) * backoffBaseMs + jitter);
  }
}

/** Map a queued/fallback payload to its Thai LIFF copy (null = fresh path). */
export function fallbackCopyFor(payload: unknown): string | null {
  if (payload !== null && typeof payload === 'object') {
    const marker = (payload as Record<string, unknown>)['fallback'];
    if (typeof marker === 'string' && marker in RESILIENCE_FALLBACK_MESSAGES) {
      return RESILIENCE_FALLBACK_MESSAGES[marker as ResilienceFallbackKey];
    }
    if ((payload as Record<string, unknown>)['queued'] === true) {
      return RESILIENCE_FALLBACK_MESSAGES.IDEMPOTENT_REPLAY_ACTIVE;
    }
  }
  return null;
}
