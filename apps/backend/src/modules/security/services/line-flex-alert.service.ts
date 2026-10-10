// SSOT Phase 120 Task 6 §5.1 — LINE security Flex card sender (swappable)
// Canonical: apps/backend/src/modules/security/services/line-flex-alert.service.ts
// (legacy src/backend/modules/security/services/line-flex-alert.service.ts)
// - Pure card builder (<10KB guard) + swappable delivery port (LogOnly
//   default; swap to the 024 LINE sender without touching callers —
//   secrets stay env-routed, never in code, OUT_OF_SCOPE_STRICT).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';

export interface SecurityAlertCard {
  lineUserId: string;
  title: string;
  location: string;
  ipAddress: string;
  device: string;
  riskLevel: string;
  timestamp: string;
}

/** LINE Flex hard limit guard (50KB); 120 budget is <10KB. */
export const SECURITY_FLEX_BUDGET_BYTES = 10_000;

export function buildSecurityAlertFlex(card: Omit<SecurityAlertCard, 'lineUserId'>): Record<string, unknown> {
  const critical = card.riskLevel === 'CRITICAL';
  return {
    type: 'flex',
    altText: `${card.title} — ${card.location}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: card.title, weight: 'bold', size: 'lg', color: critical ? '#DC2626' : '#D97706' }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `${card.location} · ${card.ipAddress}`, wrap: true, size: 'sm', color: '#111827' },
          { type: 'text', text: `${card.device} · ${card.timestamp}`, wrap: true, size: 'xs', color: '#6B7280' },
          { type: 'text', text: `ระดับความเสี่ยง: ${card.riskLevel}`, wrap: true, size: 'xs', color: critical ? '#DC2626' : '#D97706' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', action: { type: 'message', label: 'ไม่ใช่ฉัน — บล็อกเซสชัน', text: 'block-session' } },
          { type: 'button', action: { type: 'message', label: 'ยืนยันตัวตนด้วย OTP', text: 'verify-otp' } },
        ],
      },
    },
  };
}

export function securityFlexByteSize(card: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(card), 'utf8');
}

export interface FlexDeliveryPort {
  pushFlex(lineUserId: string, bubble: Record<string, unknown>): Promise<{ messageId: string }>;
}

@Injectable()
export class LogOnlyFlexDelivery implements FlexDeliveryPort {
  private readonly logger = new Logger(LogOnlyFlexDelivery.name);

  async pushFlex(lineUserId: string, bubble: Record<string, unknown>): Promise<{ messageId: string }> {
    const messageId = `sec-${Date.now().toString(36)}`;
    this.logger.log(`Security Flex for ${lineUserId}: ${JSON.stringify(bubble).slice(0, 64)}`);
    return { messageId };
  }
}

@Injectable()
export class LineFlexAlertService {
  constructor(private readonly port: LogOnlyFlexDelivery) {}

  async sendSecurityAlertCard(card: SecurityAlertCard): Promise<{ messageId: string } | null> {
    const bubble = buildSecurityAlertFlex(card);
    if (securityFlexByteSize(bubble) > SECURITY_FLEX_BUDGET_BYTES) return null;
    try {
      return await this.port.pushFlex(card.lineUserId, bubble);
    } catch {
      return null;
    }
  }
}
