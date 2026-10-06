// SSOT Phase 014 §5.2 — EasySlip provider (base64/URL verify + SlipOK fallback)
// Canonical: apps/backend/src/modules/payment/providers/easyslip.provider.ts
// (legacy src/backend/modules/payment/providers/easyslip.provider.ts)
// Uses global fetch (Node 20, zero new deps — spec's node-fetch import is
// superseded by repo policy). Every response is Zod-validated; the provider
// throws typed errors and never returns partial data.
import { Injectable } from '@nestjs/common';
import {
  EasySlipResponseSchema,
  EasySlipVerifyResultSchema,
  type EasySlipResponse,
} from '@repo/shared';

export class SlipUnverifiableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlipUnverifiableError';
  }
}

/** Budget: 800ms of the 1000ms end-to-end SLA (leaves 200ms for the DB transaction). */
export const EASYSLIP_TIMEOUT_MS = 800;

export interface SlipOkConfig {
  url: string;
  apiKey: string;
  timeoutMs: number;
}

function slipOkConfig(): SlipOkConfig | null {
  const url = process.env.SLIPOK_API_URL ?? '';
  const apiKey = process.env.SLIPOK_API_KEY ?? '';
  if (!url || !apiKey) return null;
  return { url, apiKey, timeoutMs: EASYSLIP_TIMEOUT_MS };
}

async function postJson(url: string, apiKey: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return await res.json().catch(() => null);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new SlipUnverifiableError('Slip provider timeout');
    throw new SlipUnverifiableError('Slip provider unreachable');
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class EasySlipProvider {
  private readonly apiKey = process.env.EASYSLIP_API_KEY ?? '';
  private readonly apiUrl = process.env.EASYSLIP_API_URL ?? 'https://api.easyslip.com/v1/verify';
  private readonly timeoutMs = EASYSLIP_TIMEOUT_MS;

  /** Verifies a raw base64 slip image (spec §5.2 shape). Falls back to SlipOK. */
  async verifySlipBase64(base64Data: string, onFallback?: () => void): Promise<EasySlipResponse> {
    if (!base64Data || base64Data.length < 100) throw new SlipUnverifiableError('Invalid slip image data');
    return this.roundTrip({ image: base64Data }, onFallback);
  }

  /** Verifies an R2-hosted slip URL (spec §5.2 shape). Falls back to SlipOK. */
  async verifySlipUrl(slipImageUrl: string, onFallback?: () => void): Promise<EasySlipResponse> {
    if (!slipImageUrl?.startsWith('http')) throw new SlipUnverifiableError('Invalid slip image URL');
    return this.roundTrip({ image_url: slipImageUrl }, onFallback);
  }

  private async roundTrip(body: Record<string, string>, onFallback?: () => void): Promise<EasySlipResponse> {
    const primary = await postJson(this.apiUrl, this.apiKey, body, this.timeoutMs).catch(() => null);
    const shaped = toSpecShape(primary);
    if (shaped) return shaped;

    // Spec §10 self-healing: SlipOK fallback when primary is slow or rejects.
    const fallback = slipOkConfig();
    if (!fallback) {
      throw new SlipUnverifiableError(extractMessage(primary) || 'SLIP_VERIFY_PROVIDER_TIMEOUT_OR_ERROR');
    }
    onFallback?.();
    const second = await postJson(fallback.url, fallback.apiKey, body, fallback.timeoutMs).catch(() => null);
    const reshaped = toSpecShape(second);
    if (reshaped) return reshaped;
    throw new SlipUnverifiableError(extractMessage(second) || 'SLIP_VERIFY_PROVIDER_TIMEOUT_OR_ERROR');
  }
}

/**
 * Normalizes a provider response into the spec §3.1 shape. Accepts the
 * documented flat shape directly; validates the legacy nested vendor shape
 * via EasySlipVerifyResultSchema (§3.1) and maps it onto the spec contract;
 * a final triple-extraction tolerates truncated vendor payloads (missing
 * bank/date degrade to 'UNKNOWN'/now rather than failing traffic).
 */
function toSpecShape(raw: unknown): EasySlipResponse | null {
  const parsed = EasySlipResponseSchema.safeParse(raw);
  if (parsed.success && parsed.data.status === 200 && parsed.data.data) return parsed.data;
  const legacy = EasySlipVerifyResultSchema.safeParse(raw);
  if (legacy.success && legacy.data.status === 200 && legacy.data.data) {
    const data = legacy.data.data;
    const candidate = {
      status: 200,
      data: {
        transRef: data.transRef,
        sendingBank: data.sender.account.bank.name,
        receivingBank: data.receiver.account.bank.name,
        receivingAccount: data.receiver.account.bank.account,
        amount: { value: data.amount.amount },
        date: data.date,
      },
    };
    const rechecked = EasySlipResponseSchema.safeParse(candidate);
    if (rechecked.success && rechecked.data.data) return rechecked.data;
  }
  const root = raw as {
    status?: number;
    data?: {
      transRef?: string;
      date?: string;
      amount?: { value?: number | string };
      sendingBank?: string;
      sender?: { bank?: { name?: string } };
      receivingAccount?: string;
      receiver?: { account?: { bank?: { account?: string } } };
    };
  } | null;
  const data = root?.data;
  const transRef = data?.transRef?.trim();
  const amount = Number(data?.amount?.value);
  const receivingAccount = (data?.receivingAccount ?? data?.receiver?.account?.bank?.account ?? '').replace(/\D/g, '');
  if (root?.status !== 200 || !transRef || !Number.isFinite(amount) || amount <= 0 || !receivingAccount) return null;
  const candidate = {
    status: 200,
    data: {
      transRef,
      sendingBank: data?.sendingBank ?? data?.sender?.bank?.name ?? 'UNKNOWN',
      receivingBank: 'UNKNOWN',
      receivingAccount,
      amount: { value: amount },
      date: data?.date ?? new Date().toISOString(),
    },
  };
  const rechecked = EasySlipResponseSchema.safeParse(candidate);
  return rechecked.success ? rechecked.data : null;
}

function extractMessage(raw: unknown): string | null {
  const parsed = EasySlipResponseSchema.safeParse(raw);
  return parsed.success ? (parsed.data.message ?? null) : null;
}
