// SSOT Phase 077 Task 3 — Carrier factory (shared adapter selector)
// Canonical: apps/backend/src/modules/logistics/services/carrier-factory.service.ts
// - Resolves the 077 LogisticsCarrier to its API adapter; 076 COURIER codes
//   map through carrierToLogistics() (JT/Custom stay ledger-only).
// - Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { carrierToLogistics } from '@repo/shared';
import type { CarrierApiAdapter, FetchPort } from '../adapters/carrier.interface';
import { makeFlashExpressAdapter } from '../adapters/flash-express.adapter';
import { makeKerryExpressAdapter } from '../adapters/kerry-express.adapter';
import { makeThailandPostAdapter } from '../adapters/thailand-post.adapter';

@Injectable()
export class CarrierFactoryService {
  constructor(private readonly fetch: FetchPort) {}

  forCarrier(carrier: string): CarrierApiAdapter {
    switch (carrier) {
      case 'FLASH_EXPRESS': return makeFlashExpressAdapter(this.fetch);
      case 'KERRY_EXPRESS': return makeKerryExpressAdapter(this.fetch);
      case 'THAILAND_POST': return makeThailandPostAdapter(this.fetch);
      default: throw new BadRequestException(`Unsupported integrated carrier: ${carrier}`);
    }
  }

  /** 076 provider code -> integrated adapter (null = ledger-only). */
  forProvider(provider: string): CarrierApiAdapter | null {
    const mapped = carrierToLogistics(provider);
    return mapped ? this.forCarrier(mapped) : null;
  }
}
