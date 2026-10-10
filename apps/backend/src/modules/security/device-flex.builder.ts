// SSOT Phase 119 Task 7 §7.1 — device security LINE Flex builder (pure)
// Canonical: apps/backend/src/modules/security/device-flex.builder.ts
// - Builds eviction + fraud-lock bubbles (<10KB guard, 084/111-119
//   vocabulary-compatible plain objects — delivery rides the swappable
//   DeviceNotifyPort, default LogOnly streams it).
// - RISK_CALL: no LINE push dep in this repo (024 client owns credentials).
// - Zero new deps.
export type DeviceOutcome = 'EVICTED' | 'FRAUD_LOCK';

export interface DeviceFlex {
  type: 'flex';
  altText: string;
  contents: {
    type: 'bubble';
    header: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; weight?: string; size?: string; color?: string }> };
    body: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; wrap?: boolean; size?: string; color?: string }> };
    footer?: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'button'; action: { type: 'uri'; label: string; uri: string } }> };
  };
}

/** LINE Flex hard limit guard (50KB); 119 budget is <10KB. */
export const DEVICE_FLEX_BUDGET_BYTES = 10_000;

export function buildDeviceFlex(args: {
  outcome: DeviceOutcome;
  tenantName: string;
  detail?: string;
  otpDeepLink?: string;
}): DeviceFlex {
  const title = args.outcome === 'EVICTED' ? 'อุปกรณ์อื่นกำลังรับชมอยู่' : 'พบบัญชีถูกแชร์ — ล็อกชั่วคราวแล้ว';
  const lines = [title];
  if (args.detail) lines.push(args.detail);
  lines.push(args.tenantName);
  const bubble: DeviceFlex = {
    type: 'flex',
    altText: `${title} — ${args.tenantName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: title, weight: 'bold', size: 'lg', color: args.outcome === 'EVICTED' ? '#D97706' : '#DC2626' }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: lines.map((text, i) => ({
          type: 'text' as const,
          text,
          wrap: true,
          size: i === 0 ? ('sm' as const) : ('xs' as const),
          color: i === 0 ? '#111827' : '#6B7280',
        })),
      },
    },
  };
  if (args.outcome === 'FRAUD_LOCK' && args.otpDeepLink) {
    bubble.contents.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'button', action: { type: 'uri', label: 'ยืนยัน OTP', uri: args.otpDeepLink } }],
    };
  }
  return bubble;
}

/** Serialized byte size of a device bubble (must stay <10KB). */
export function deviceFlexByteSize(bubble: DeviceFlex): number {
  return Buffer.byteLength(JSON.stringify(bubble), 'utf8');
}
