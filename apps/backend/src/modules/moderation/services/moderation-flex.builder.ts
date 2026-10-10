// SSOT Phase 112 Task 8 §5.1 — moderation LINE Flex builder (pure)
// Canonical: apps/backend/src/modules/moderation/services/moderation-flex.builder.ts
// - Builds PASSED / QUARANTINED / APPEAL_PENDING / APPROVED / REJECTED bubbles
//   (<10KB guard, 084/111 vocabulary-compatible plain objects — delivery
//   rides the swappable ModerationNotifyPort, default LogOnly streams it).
// - RISK_CALL: no LINE push dep in this repo (024 client owns credentials).
// - Zero new deps.
export type ModerationOutcome = 'PASSED' | 'QUARANTINED' | 'APPEAL_PENDING' | 'APPROVED' | 'REJECTED';

export interface ModerationFlex {
  type: 'flex';
  altText: string;
  contents: {
    type: 'bubble';
    header: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; weight?: string; size?: string; color?: string }> };
    body: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; wrap?: boolean; size?: string; color?: string }> };
    footer?: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'button'; action: { type: 'uri'; label: string; uri: string } }> };
  };
}

/** LINE Flex hard limit guard (50KB); 112 budget is <10KB. */
export const MOD_FLEX_BUDGET_BYTES = 10_000;

const HEADER_COLOR: Record<ModerationOutcome, string> = {
  PASSED: '#059669',
  QUARANTINED: '#DC2626',
  APPEAL_PENDING: '#D97706',
  APPROVED: '#059669',
  REJECTED: '#DC2626',
};

const HEADER_TEXT: Record<ModerationOutcome, string> = {
  PASSED: 'ตรวจสอบเนื้อหาผ่าน',
  QUARANTINED: 'เนื้อหาถูกกักกัน',
  APPEAL_PENDING: 'รับเรื่องอุทธรณ์แล้ว',
  APPROVED: 'อุทธรณ์ผ่าน วางขายแล้ว',
  REJECTED: 'อุทธรณ์ไม่ผ่าน',
};

export function buildModerationFlex(args: {
  outcome: ModerationOutcome;
  productTitle: string;
  tenantName: string;
  detail?: string;
  appealDeepLink?: string;
}): ModerationFlex {
  const lines = [`"${args.productTitle}" — ${HEADER_TEXT[args.outcome]}`];
  if (args.detail) lines.push(args.detail);
  lines.push(args.tenantName);
  const bubble: ModerationFlex = {
    type: 'flex',
    altText: `${HEADER_TEXT[args.outcome]} — ${args.tenantName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: HEADER_TEXT[args.outcome], weight: 'bold', size: 'lg', color: HEADER_COLOR[args.outcome] }],
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
  if ((args.outcome === 'QUARANTINED' || args.outcome === 'REJECTED') && args.appealDeepLink) {
    bubble.contents.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'button', action: { type: 'uri', label: 'ยื่นอุทธรณ์', uri: args.appealDeepLink } }],
    };
  }
  return bubble;
}

/** Serialized byte size of a moderation bubble (must stay <10KB). */
export function moderationFlexByteSize(bubble: ModerationFlex): number {
  return Buffer.byteLength(JSON.stringify(bubble), 'utf8');
}
