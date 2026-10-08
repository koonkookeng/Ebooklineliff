// SSOT Phase 077 Task 3 — Kerry (KEX) Express adapter
// Canonical: apps/backend/src/modules/logistics/adapters/kerry-express.adapter.ts
// - Same port shape as Flash (Zero Redundant); KEX signs with HMAC-SHA256
//   over outTradeNo|weight and posts JSON.
// - Zero new deps.
import { createHmac } from 'node:crypto';
import { InternalServerErrorException } from '@nestjs/common';
import type { CarrierApiAdapter, FetchPort, ParcelPayload, ParcelBookingResult } from './carrier.interface';

export function makeKerryExpressAdapter(fetch: FetchPort, baseUrl = 'https://api.kex-express.com/v1'): CarrierApiAdapter {
  return {
    carrier: 'KERRY_EXPRESS',
    async bookParcel(p: ParcelPayload): Promise<ParcelBookingResult> {
      const sign = createHmac('sha256', p.mchKey).update(`${p.outTradeNo}|${p.weightGrams}`).digest('hex');
      const res = await fetch(`${baseUrl}/parcels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Mch-Id': p.mchId, 'X-Sign': sign },
        body: JSON.stringify({
          outTradeNo: p.outTradeNo,
          sender: { name: p.senderName, phone: p.senderPhone, address: p.senderAddress },
          recipient: { name: p.recipientName, phone: p.recipientPhone, address: p.recipientAddress },
          weightGrams: p.weightGrams,
          remark: p.remark ?? '',
        }),
      });
      const result = (await res.json().catch(() => null)) as { success?: boolean; message?: string; trackingNumber?: string; courierOrderId?: string; labelUrl?: string } | null;
      if (!res.ok || !result?.success || !result.trackingNumber) {
        throw new InternalServerErrorException(`Kerry Booking Failed: ${result?.message ?? res.status}`);
      }
      return {
        trackingNumber: result.trackingNumber,
        courierOrderId: result.courierOrderId ?? null,
        labelUrl: result.labelUrl ?? null,
      };
    },
  };
}
