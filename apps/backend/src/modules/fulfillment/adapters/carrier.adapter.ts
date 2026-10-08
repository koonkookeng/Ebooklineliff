// SSOT Phase 076 Task 2 — Unified carrier adapter pattern (Zero Redundant)
// Canonical: apps/backend/src/modules/fulfillment/adapters/carrier.adapter.ts
// - One port for all 5 carriers; deterministic tracking builder here is the
//   seam where live HTTP calls attach (config-gated, tenant credentials stay
//   in LogisticsCarrierConfig — never logged).
// - Zero new deps.
import { buildTrackingNumber } from '../domain/fulfillment.entity';

export interface CarrierBookingPayload {
  tenantId: string;
  courierProvider: string;
  orderId: string;
  orderNumber: string;
  recipientName: string;
  recipientPhone: string;
  shippingAddress: string;
  postalCode: string;
  weightGrams: number;
  warehouseId: string;
}

export interface CarrierBookingResult {
  trackingNumber: string;
  sortingCode: string | null;
  warehouseId: string;
}

export interface CarrierAdapter {
  readonly provider: string;
  book(payload: CarrierBookingPayload): Promise<CarrierBookingResult>;
}

/** Deterministic stub: live HTTP attaches here behind tenant config. */
function stub(provider: string): CarrierAdapter {
  return {
    provider,
    async book(p: CarrierBookingPayload): Promise<CarrierBookingResult> {
      return {
        trackingNumber: buildTrackingNumber(provider, p.orderNumber),
        sortingCode: `${provider.slice(0, 2)}-${p.postalCode.slice(0, 2)}`,
        warehouseId: p.warehouseId,
      };
    },
  };
}

export const FLASH_ADAPTER: CarrierAdapter = stub('FLASH_EXPRESS');
export const KEX_ADAPTER: CarrierAdapter = stub('KEX_EXPRESS');
export const JT_ADAPTER: CarrierAdapter = stub('JT_EXPRESS');
export const THAILAND_POST_ADAPTER: CarrierAdapter = stub('THAILAND_POST');
export const CUSTOM_FLEET_ADAPTER: CarrierAdapter = stub('CUSTOM_FLEET');

export const CARRIER_PRIORITY = [
  'FLASH_EXPRESS',
  'KEX_EXPRESS',
  'JT_EXPRESS',
  'THAILAND_POST',
  'CUSTOM_FLEET',
] as const;

export function carrierAdapterFor(provider: string): CarrierAdapter {
  switch (provider) {
    case 'FLASH_EXPRESS': return FLASH_ADAPTER;
    case 'KEX_EXPRESS': return KEX_ADAPTER;
    case 'JT_EXPRESS': return JT_ADAPTER;
    case 'THAILAND_POST': return THAILAND_POST_ADAPTER;
    default: return CUSTOM_FLEET_ADAPTER;
  }
}
