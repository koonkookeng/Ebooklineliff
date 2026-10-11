// SSOT Phase 122 Task 5 §5.1 — LINE messaging external client (fetch transport)
// Canonical: apps/backend/src/infrastructure/external/clients/line/line-messaging.client.ts
// (legacy src/backend/infrastructure/external/clients/line/*)
// - Thin fetch transport for the LINE push API (the 019/024 lanes own
//   Flex composition + idempotency; this client owns timeout + envelope).
//   Pairs with LineCircuitAdapter (breaker owns outage gating).
// - Zero new deps (global fetch + AbortSignal.timeout only).
import { Injectable } from '@nestjs/common';
import { EXTERNAL_CALL_TIMEOUT_MS } from '@repo/shared';

@Injectable()
export class LineMessagingClient {
  private readonly baseUrl = process.env['LINE_API_URL'] ?? 'https://api.line.me';
  private readonly channelToken = process.env['LINE_CHANNEL_ACCESS_TOKEN'] ?? '';

  /** POST push with a hard timeout (breaker measures the same budget). */
  async push(lineUserId: string, message: unknown, timeoutMs = EXTERNAL_CALL_TIMEOUT_MS): Promise<{ messageId: string }> {
    const res = await fetch(`${this.baseUrl}/v2/bot/message/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.channelToken}` },
      body: JSON.stringify({ to: lineUserId, messages: Array.isArray(message) ? message : [message] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`LINE_PUSH_HTTP_${res.status}`);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { messageId: String(data['messageId'] ?? `line-${Date.now().toString(36)}`) };
  }
}
