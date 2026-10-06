// SSOT Phase 012 §5.1/§10 + Phase 014 §5.2 — EasySlip verify adapter
// Canonical: apps/backend/src/modules/payment/services/easyslip-verify.adapter.ts
// Transport is delegated to EasySlipProvider (URL + base64 + SlipOK fallback,
// Zod-validated); this adapter keeps the Phase-012 VerifiedSlip contract and
// emits the fallback analytics hook. Uses global fetch (zero new deps).
import { Injectable } from '@nestjs/common';
import { EasySlipProvider } from '../providers/easyslip.provider';
import type { EasySlipResponse } from '@repo/shared';

// Single source (defined in the provider): re-exported so Phase-012/013
// import sites keep working unchanged.
export { SlipUnverifiableError, EASYSLIP_TIMEOUT_MS } from '../providers/easyslip.provider';
import { SlipUnverifiableError } from '../providers/easyslip.provider';

export interface VerifiedSlip {
  transRef: string;
  amount: number;
  receiverAccount: string;
  senderBank: string;
  raw: unknown;
}

const looksLikeHttpUrl = (s: string): boolean => s.startsWith('http://') || s.startsWith('https://');

@Injectable()
export class EasySlipVerifyAdapter {
  constructor(private readonly provider = new EasySlipProvider()) {}

  /** Accepts an R2 URL (preferred) or a raw base64 image (v1 API path). */
  async verify(slipImage: string, onFallback?: () => void): Promise<VerifiedSlip> {
    if (!slipImage || slipImage.length < 10) throw new SlipUnverifiableError('Invalid slip image URL');
    let body: EasySlipResponse;
    try {
      body = looksLikeHttpUrl(slipImage)
        ? await this.provider.verifySlipUrl(slipImage, onFallback)
        : await this.provider.verifySlipBase64(slipImage, onFallback);
    } catch (e) {
      if (e instanceof SlipUnverifiableError) throw e;
      throw new SlipUnverifiableError('EasySlip unreachable');
    }
    // Provider guarantees the spec §3.1 shape (flat fields, Zod-validated).
    const data = body.data;
    const transRef = data?.transRef?.trim();
    const amount = Number(data?.amount?.value);
    const receiverAccount = (data?.receivingAccount ?? '').replace(/\D/g, '');
    if (!transRef || !Number.isFinite(amount) || amount <= 0 || !receiverAccount) {
      throw new SlipUnverifiableError('EasySlip response missing transRef/amount/account');
    }
    return {
      transRef,
      amount,
      receiverAccount,
      senderBank: data?.sendingBank ?? 'UNKNOWN',
      raw: body,
    };
  }
}
