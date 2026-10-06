// SSOT Phase 019 §6 — Type-safe receipt fetcher (detail + manual request)
// Canonical: apps/frontend/lib/receipt.ts
// (legacy src/frontend/lib/receipt.ts)
import type { ReceiptLog } from '@repo/shared';

export type { ReceiptLog };

export interface ReceiptItem {
  title: string;
  quantity: number;
  totalPrice: number;
}

export interface ReceiptDetail extends ReceiptLog {
  orderNumber: string;
  netAmount: number;
  downloadUrl: string | null;
  liffLibraryUrl: string;
  items: ReceiptItem[];
}

export async function fetchReceiptDetail(orderId: string): Promise<ReceiptDetail> {
  const res = await fetch(`/api/receipts/order/${encodeURIComponent(orderId)}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'ไม่พบข้อมูลใบเสร็จ');
  }
  return (await res.json()) as ReceiptDetail;
}

export async function requestReceipt(orderId: string, force = false): Promise<ReceiptLog> {
  const res = await fetch('/api/receipts/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, force }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'ขอใบเสร็จไม่สำเร็จ');
  }
  return (await res.json()) as ReceiptLog;
}
