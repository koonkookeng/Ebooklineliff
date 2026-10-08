// SSOT Phase 077 §6.1/Task 5 — LINE tracking Flex message service
// Canonical: apps/backend/src/modules/logistics/services/line-notification.service.ts
// - buildTrackingFlex: pure Flex bubble (§6.1 verbatim shape, carrier brand
//   header); sendTrackingFlexMessage: Zod gate -> LINE push via injected
//   fetch -> 5xx/network failure goes to the retry stream (§10 backoff x3).
// - Zero new deps (global fetch only).
import { BadRequestException, Injectable } from '@nestjs/common';
import { LINE_RETRY_STREAM, LineTrackingMessageSchema, carrierBrand, type LineTrackingMessage } from '@repo/shared';
import type { FetchPort } from '../adapters/carrier.interface';

export interface LineRetryBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

/** Pure Flex bubble builder (§6.1) — unit-testable without HTTP. */
export function buildTrackingFlex(data: LineTrackingMessage): Record<string, unknown> {
  const brand = carrierBrand(data.carrierName);
  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: brand.bg,
      contents: [
        { type: 'text', text: 'อัปเดตการจัดส่งพัสดุ', weight: 'bold', color: brand.fg, size: 'sm' },
        { type: 'text', text: `คำสั่งซื้อ #${data.orderNumber}`, weight: 'bold', color: brand.fg, size: 'lg' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        row('ขนส่ง:', data.carrierName),
        row('เลขพัสดุ:', data.trackingNumber),
        row('สถานะล่าสุด:', data.statusText),
        ...(data.estimatedDelivery ? [row('กำหนดถึง:', data.estimatedDelivery)] : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          action: { type: 'uri', label: 'ติดตามพัสดุแบบเรียลไทม์', uri: data.trackingUrl },
          style: 'primary',
          color: '#1DB446',
        },
      ],
    },
  };
}

function row(label: string, value: string): Record<string, unknown> {
  return {
    type: 'box',
    layout: 'baseline',
    margin: 'md',
    contents: [
      { type: 'text', text: label, color: '#aaaaaa', size: 'sm', flex: 2 },
      { type: 'text', text: value, color: '#333333', size: 'sm', flex: 5, weight: 'bold', wrap: true },
    ],
  };
}

@Injectable()
export class LineNotificationService {
  constructor(
    private readonly fetch: FetchPort,
    private readonly channelToken: string,
    private readonly bus: LineRetryBus,
  ) {}

  /** Push the tracking Flex card (<500ms budget); 5xx -> retry stream. */
  async sendTrackingFlexMessage(raw: LineTrackingMessage): Promise<{ pushed: boolean }> {
    const parsed = LineTrackingMessageSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid LINE tracking message');
    const data = parsed.data;

    let res: { ok: boolean; status: number };
    try {
      res = await this.fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.channelToken}` },
        body: JSON.stringify({
          to: data.lineUserId,
          messages: [{ type: 'flex', altText: `อัปเดตสถานะพัสดุ ${data.trackingNumber}`, contents: buildTrackingFlex(data) }],
        }),
      });
    } catch {
      await this.enqueueRetry(data, 'network');
      return { pushed: false };
    }
    if (!res.ok && res.status >= 500) {
      await this.enqueueRetry(data, `http-${res.status}`);
      return { pushed: false };
    }
    return { pushed: res.ok };
  }

  private async enqueueRetry(data: LineTrackingMessage, reason: string): Promise<void> {
    await this.bus
      .xadd(LINE_RETRY_STREAM, {
        event: 'line.tracking.retry',
        lineUserId: data.lineUserId,
        trackingNumber: data.trackingNumber,
        reason,
        attempt: 1,
        at: Date.now(),
      })
      .catch(() => undefined);
  }
}
