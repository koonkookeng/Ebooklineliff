// SSOT Phase 077 §5.2 — Flash Express Open API v2 adapter
// Canonical: apps/backend/src/modules/logistics/adapters/flash-express.adapter.ts
// - Sorted-param SHA256 signature (spec §5.2 verbatim shape); HTTP through
//   the injected fetch port so contract tests run offline.
// - Zero new deps.
import { InternalServerErrorException } from '@nestjs/common';
import { flashSignature } from '@repo/shared';
import { createHash } from 'node:crypto';
import type { CarrierApiAdapter, FetchPort, ParcelPayload, ParcelBookingResult } from './carrier.interface';

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

export function flashRequestParams(p: ParcelPayload): Record<string, string | number> {
  return {
    mchId: p.mchId,
    nonceStr: Date.now().toString(),
    outTradeNo: p.outTradeNo,
    expressCategory: 1,
    srcName: p.senderName,
    srcPhone: p.senderPhone,
    srcDetailAddress: p.senderAddress,
    dstName: p.recipientName,
    dstPhone: p.recipientPhone,
    dstDetailAddress: p.recipientAddress,
    weight: p.weightGrams,
  };
}

export function makeFlashExpressAdapter(fetch: FetchPort, baseUrl = 'https://open-api.flashexpress.com/v2'): CarrierApiAdapter {
  return {
    carrier: 'FLASH_EXPRESS',
    async bookParcel(p: ParcelPayload): Promise<ParcelBookingResult> {
      const params = flashRequestParams(p);
      const signed = { ...params, sign: flashSignature(params, p.mchKey, sha256Hex) };
      const res = await fetch(`${baseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(Object.entries(signed).map(([k, v]): [string, string] => [k, String(v)])).toString(),
      });
      const result = (await res.json().catch(() => null)) as { code?: number; message?: string; data?: { pno?: string; courierOrderId?: string; labelUrl?: string } } | null;
      if (!res.ok || !result || result.code !== 1 || !result.data?.pno) {
        throw new InternalServerErrorException(`Flash Express Booking Failed: ${result?.message ?? res.status}`);
      }
      return {
        trackingNumber: result.data.pno,
        courierOrderId: result.data.courierOrderId ?? null,
        labelUrl: result.data.labelUrl ?? null,
      };
    },
  };
}
