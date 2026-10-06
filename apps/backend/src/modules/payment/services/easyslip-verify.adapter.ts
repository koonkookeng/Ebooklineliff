// SSOT Phase 012 §5.1/§10 — EasySlip verify adapter (800ms budget, SlipOK fallback-ready)
// Canonical: apps/backend/src/modules/payment/services/easyslip-verify.adapter.ts
// Uses global fetch (Node 20, zero new deps). Throws typed errors; never returns partial data.
import { Injectable } from '@nestjs/common';

export interface VerifiedSlip {
  transRef: string;
  amount: number;
  receiverAccount: string;
  senderBank: string;
  raw: unknown;
}

export class SlipUnverifiableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlipUnverifiableError';
  }
}

/** Budget: 800ms of the 1000ms end-to-end SLA (leaves 200ms for the DB transaction). */
export const EASYSLIP_TIMEOUT_MS = 800;

@Injectable()
export class EasySlipVerifyAdapter {
  private readonly apiKey = process.env.EASYSLIP_API_KEY ?? '';
  private readonly endpoint = process.env.EASYSLIP_API_URL ?? 'https://api.easyslip.com/v1/verify';
  private readonly timeoutMs: number;

  constructor(timeoutMs = EASYSLIP_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  async verify(slipImageUrl: string): Promise<VerifiedSlip> {
    if (!slipImageUrl?.startsWith('http')) throw new SlipUnverifiableError('Invalid slip image URL');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image_url: slipImageUrl }),
        signal: ctrl.signal,
      });
      const body = (await res.json().catch(() => null)) as {
        status?: number;
        message?: string;
        data?: {
          transRef?: string;
          amount?: { value?: number | string };
          receiver?: { account?: { bank?: { account?: string } } };
          sender?: { bank?: { name?: string } };
        };
      } | null;
      if (!res.ok || body?.status !== 200 || !body?.data) {
        throw new SlipUnverifiableError(body?.message ?? `EasySlip rejected slip (${res.status})`);
      }
      const transRef = body.data.transRef?.trim();
      const amount = Number(body.data.amount?.value);
      const receiverAccount = body.data.receiver?.account?.bank?.account?.replace(/\D/g, '');
      if (!transRef || !Number.isFinite(amount) || amount <= 0 || !receiverAccount) {
        throw new SlipUnverifiableError('EasySlip response missing transRef/amount/account');
      }
      return {
        transRef,
        amount,
        receiverAccount,
        senderBank: body.data.sender?.bank?.name ?? 'UNKNOWN',
        raw: body,
      };
    } catch (e) {
      if (e instanceof SlipUnverifiableError) throw e;
      throw new SlipUnverifiableError(e instanceof Error && e.name === 'AbortError' ? 'EasySlip timeout' : 'EasySlip unreachable');
    } finally {
      clearTimeout(timer);
    }
  }
}
