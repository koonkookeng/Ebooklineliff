// SSOT Phase 122 Task 5 §5.1 — EasySlip external client (fetch transport)
// Canonical: apps/backend/src/infrastructure/external/clients/easyslip/easyslip.client.ts
// (legacy src/backend/infrastructure/external/clients/easyslip/*)
// - Thin fetch transport for the EasySlip verify API (the 014 provider lane
//   owns parsing/validation; this client owns timeout + envelope). Pairs
//   with EasySlipCircuitAdapter (breaker owns outage gating).
// - Zero new deps (global fetch + AbortSignal.timeout only).
import { Injectable } from '@nestjs/common';
import { EXTERNAL_CALL_TIMEOUT_MS } from '@repo/shared';

export interface EasySlipVerifyRequest {
  slipUrl: string;
}

export interface EasySlipVerifyResponse {
  transRef: string;
  amount: number;
  receiverAccount: string;
}

@Injectable()
export class EasySlipClient {
  private readonly baseUrl = process.env['EASYSLIP_API_URL'] ?? 'https://developer.easyslip.com';
  private readonly apiKey = process.env['EASYSLIP_API_KEY'] ?? '';

  /** POST verify with a hard timeout (breaker measures the same budget). */
  async verify(req: EasySlipVerifyRequest, timeoutMs = EXTERNAL_CALL_TIMEOUT_MS): Promise<EasySlipVerifyResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ url: req.slipUrl }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`EASYSLIP_HTTP_${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    const payload = (data['data'] ?? data) as Record<string, unknown>;
    const transRef = String(payload['transRef'] ?? payload['trans_ref'] ?? '');
    const amount = Number(payload['amount'] ?? Number.NaN);
    const receiverAccount = String(payload['receiverAccount'] ?? payload['receiver_account'] ?? '');
    if (!transRef || !Number.isFinite(amount) || !receiverAccount) throw new Error('EASYSLIP_MALFORMED_RESPONSE');
    return { transRef, amount, receiverAccount };
  }
}
