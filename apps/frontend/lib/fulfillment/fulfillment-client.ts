// SSOT Phase 076 §6 — Fulfillment client (REST transport + TSPL spool)
// Canonical: apps/frontend/lib/fulfillment/fulfillment-client.ts
// - Proxied REST (auth passthrough); Web Serial TSPL spool with PDF
//   fallback (§10 self-heal); blob URLs revoked after print (Gate 5 <45MB).
// - Zero-dep (fetch only).
export type FulfillmentStatus =
  | 'QUEUE_INIT'
  | 'IDLE'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'ERROR';

export interface QueueRow {
  orderId: string;
  orderNumber: string;
  courierProvider: string;
  trackingNumber: string | null;
  status: string;
  updatedAt: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`fulfillment ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function fulfillmentApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    queue: (status: string, page: number, limit = 20) =>
      json<{ rows: QueueRow[]; total: number }>(
        `/api/v1/fulfillment/queue?${qs}&status=${encodeURIComponent(status)}&page=${page}&limit=${limit}`,
      ),
    book: (body: unknown) => post(`/api/v1/fulfillment/queue/batch?${qs}`, body),
    drain: (batchId: string, body: unknown) => post(`/api/v1/fulfillment/queue/drain?${qs}&batchId=${batchId}`, body),
    print: (body: unknown) =>
      post(`/api/v1/fulfillment/print/batch?${qs}`, body) as Promise<{
        success: boolean;
        totalProcessed: number;
        failedOrders: Array<{ orderId: string; reason: string }>;
        objectKey: string;
        downloadUrl: string;
        rawTsplCommands: string;
      }>,
  };
}

/** Stream raw TSPL to a Web Serial thermal printer; false = no port. */
export async function spoolTsplToSerial(tspl: string): Promise<boolean> {
  const nav = navigator as Navigator & { serial?: { requestPort(): Promise<SerialPortLike> } };
  if (!nav.serial) return false;
  const port = await nav.serial.requestPort();
  await port.open({ baudRate: 9600 });
  try {
    const writer = port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(tspl));
    } finally {
      writer.releaseLock();
    }
    return true;
  } finally {
    await port.close().catch(() => undefined);
  }
}

interface SerialPortLike {
  open(opts: { baudRate: number }): Promise<void>;
  writable: { getWriter(): { write(c: Uint8Array): Promise<void>; releaseLock(): void } };
  close(): Promise<void>;
}

/** Open a blob URL then revoke it (Gate 5 RAM discipline). */
export function openBlobAndRevoke(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
