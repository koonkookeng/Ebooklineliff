// SSOT Phase 024 Task 5 — Native LINE push client (service-message transport)
// Canonical: apps/backend/src/modules/line-service-message/infrastructure/line-api.client.ts
// - Zero-dep: global fetch + AbortController timeout (<300ms budget, §1.1).
// - Error taxonomy mirrors receipt-queue.processor: 429/5xx/timeout → Retryable;
//   4xx (incl. 400 invalid flex) → Permanent (prevents poison retries).
// - Idempotency-Key header per log row (safe redelivery on timeout ambiguity).
import { Injectable, Logger } from '@nestjs/common';

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const PUSH_TIMEOUT_MS = 5000;

export class RetryableLineError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RetryableLineError';
  }
}

export class PermanentLineError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PermanentLineError';
  }
}

export interface PushResult {
  lineMessageId: string | null;
}

@Injectable()
export class LineApiClient {
  private readonly logger = new Logger(LineApiClient.name);

  async pushFlex(channelAccessToken: string, lineUserId: string, altText: string, flex: Record<string, unknown>, idempotencyKey: string): Promise<PushResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PUSH_TIMEOUT_MS);
    try {
      const res = await fetch(LINE_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${channelAccessToken}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          to: lineUserId,
          messages: [{ type: 'flex', altText, contents: flex }],
        }),
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        throw new RetryableLineError(`LINE push retryable: ${res.status}`, res.status);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new PermanentLineError(`LINE push rejected: ${res.status} ${text.slice(0, 200)}`, res.status);
      }
      const body = (await res.json().catch(() => null)) as { messageId?: string } | null;
      return { lineMessageId: body?.messageId ?? null };
    } catch (err) {
      if (err instanceof RetryableLineError || err instanceof PermanentLineError) throw err;
      throw new RetryableLineError(`LINE push transport failure: ${err instanceof Error ? err.message : 'unknown'}`, 0);
    } finally {
      clearTimeout(timer);
    }
  }
}
