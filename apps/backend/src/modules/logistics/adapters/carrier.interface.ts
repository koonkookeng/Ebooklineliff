// SSOT Phase 077 Task 3 — Shared carrier adapter factory (Zero Redundant)
// Canonical: apps/backend/src/modules/logistics/adapters/carrier.interface.ts
// - One port for Flash/Kerry/ThailandPost; live HTTP attaches through the
//   injected fetch port with tenant credentials from CarrierApiConfig.
// - Zero new deps (global fetch only).
export interface ParcelPayload {
  mchId: string;
  mchKey: string;
  outTradeNo: string;
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  weightGrams: number;
  remark?: string;
  isSandbox: boolean;
}

export interface ParcelBookingResult {
  trackingNumber: string;
  courierOrderId: string | null;
  labelUrl: string | null;
}

export interface CarrierApiAdapter {
  readonly carrier: string;
  bookParcel(payload: ParcelPayload): Promise<ParcelBookingResult>;
}

export type FetchPort = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;
