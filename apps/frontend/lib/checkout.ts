// SSOT Phase 012 §6 — Type-safe checkout fetcher (order + slip upload + verify)
// Phase 013: + dynamic QR lifecycle (generate/status with fractional cent + TTL)
// Canonical: apps/frontend/lib/checkout.ts
import type {
  CreateOrderInput,
  CreateOrderPayload,
  SlipVerificationResult,
  CreatePromptPayQRRequest,
  PromptPayQRPayload,
  PromptPayExpiryStatus,
} from '@repo/shared';

export type {
  CreateOrderInput,
  CreateOrderPayload,
  SlipVerificationResult,
  CreatePromptPayQRRequest as CreatePromptPayQRInput,
  PromptPayQRPayload,
  PromptPayExpiryStatus,
};

export async function createSmartOrder(input: CreateOrderInput): Promise<CreateOrderPayload> {
  const res = await fetch('/api/checkout/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Failed to create order');
  }
  return (await res.json()) as CreateOrderPayload;
}

export async function uploadSlipImage(orderId: string, file: File): Promise<{ slipImageUrl: string }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  const res = await fetch('/api/storage/upload-slip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, filename: file.name, contentType: file.type, dataBase64: btoa(binary) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Slip upload failed');
  }
  return (await res.json()) as { slipImageUrl: string };
}

export async function verifyPaymentSlip(orderId: string, slipImageUrl: string): Promise<SlipVerificationResult> {
  const res = await fetch('/api/payment/verify-slip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, slipImageUrl }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'สลิปไม่ถูกต้อง หรือถูกใช้งานไปแล้ว');
  }
  return (await res.json()) as SlipVerificationResult;
}

export async function generateDynamicQR(input: CreatePromptPayQRRequest): Promise<PromptPayQRPayload> {
  const res = await fetch('/api/payment/promptpay/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'สร้าง QR ไม่สำเร็จ');
  }
  return (await res.json()) as PromptPayQRPayload;
}

export async function regenerateDynamicQR(input: CreatePromptPayQRRequest): Promise<PromptPayQRPayload> {
  const res = await fetch('/api/payment/promptpay/regenerate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'สร้าง QR ใหม่ไม่สำเร็จ');
  }
  return (await res.json()) as PromptPayQRPayload;
}

export async function getPromptPayQRStatus(orderId: string): Promise<PromptPayExpiryStatus> {
  const res = await fetch(`/api/payment/promptpay/status?orderId=${encodeURIComponent(orderId)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'ตรวจสถานะ QR ไม่สำเร็จ');
  }
  return (await res.json()) as PromptPayExpiryStatus;
}
