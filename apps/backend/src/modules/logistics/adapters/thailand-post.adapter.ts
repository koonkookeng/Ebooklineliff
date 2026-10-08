// SSOT Phase 077 Task 3 — Thailand Post adapter
// Canonical: apps/backend/src/modules/logistics/adapters/thailand-post.adapter.ts
// - Same port shape (Zero Redundant); Thai Post uses bearer mchKey + JSON.
// - Zero new deps.
import { InternalServerErrorException } from '@nestjs/common';
import type { CarrierApiAdapter, FetchPort, ParcelPayload, ParcelBookingResult } from './carrier.interface';

export function makeThailandPostAdapter(fetch: FetchPort, baseUrl = 'https://api.thailandpost.co.th/v1'): CarrierApiAdapter {
  return {
    carrier: 'THAILAND_POST',
    async bookParcel(p: ParcelPayload): Promise<ParcelBookingResult> {
      const res = await fetch(`${baseUrl}/shipments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.mchKey}` },
        body: JSON.stringify({
          merchantId: p.mchId,
          reference: p.outTradeNo,
          sender: { name: p.senderName, phone: p.senderPhone, address: p.senderAddress },
          recipient: { name: p.recipientName, phone: p.recipientPhone, address: p.recipientAddress },
          weightGrams: p.weightGrams,
          remark: p.remark ?? '',
        }),
      });
      const result = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; trackingNumber?: string; courierOrderId?: string; labelUrl?: string } | null;
      if (!res.ok || !result?.ok || !result.trackingNumber) {
        throw new InternalServerErrorException(`Thailand Post Booking Failed: ${result?.message ?? res.status}`);
      }
      return {
        trackingNumber: result.trackingNumber,
        courierOrderId: result.courierOrderId ?? null,
        labelUrl: result.labelUrl ?? null,
      };
    },
  };
}
