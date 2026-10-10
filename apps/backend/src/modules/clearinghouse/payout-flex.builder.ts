// SSOT Phase 114 Task 6 §8.1 — payout LINE Flex builder (pure)
// Canonical: apps/backend/src/modules/clearinghouse/payout-flex.builder.ts
// - Builds the automated-payout execution bubble (<10KB guard, 084/111-113
//   vocabulary-compatible plain object — delivery rides the swappable
//   ClearinghouseNotifyPort, default LogOnly streams it).
// - RISK_CALL: no LINE push dep in this repo (024 client owns credentials).
// - Zero new deps.
export interface PayoutFlex {
  type: 'flex';
  altText: string;
  contents: {
    type: 'bubble';
    header: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; weight?: string; size?: string; color?: string }> };
    body: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; wrap?: boolean; size?: string; color?: string }> };
    footer?: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'button'; action: { type: 'uri'; label: string; uri: string } }> };
  };
}

/** LINE Flex hard limit guard (50KB); 114 budget is <10KB. */
export const PAYOUT_FLEX_BUDGET_BYTES = 10_000;

const thb = (n: number): string => `฿${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildPayoutFlex(args: {
  payoutId: string;
  gross: number;
  tax: number;
  net: number;
  tenantName: string;
  certDeepLink?: string;
}): PayoutFlex {
  const bubble: PayoutFlex = {
    type: 'flex',
    altText: `โอนรายได้ ${thb(args.net)} — ${args.tenantName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: 'ตัดจ่ายรายได้สำเร็จ', weight: 'bold', size: 'lg', color: '#059669' }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `ยอดโอน ${thb(args.net)} (หักภาษี 3% ${thb(args.tax)} จาก ${thb(args.gross)})`, wrap: true, size: 'sm', color: '#111827' },
          { type: 'text', text: `ref ${args.payoutId.slice(0, 8)} · ${args.tenantName}`, wrap: true, size: 'xs', color: '#6B7280' },
        ],
      },
    },
  };
  if (args.certDeepLink) {
    bubble.contents.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'button', action: { type: 'uri', label: 'ดาวน์โหลด 50 ทวิ', uri: args.certDeepLink } }],
    };
  }
  return bubble;
}

/** Serialized byte size of a payout bubble (must stay <10KB). */
export function payoutFlexByteSize(bubble: PayoutFlex): number {
  return Buffer.byteLength(JSON.stringify(bubble), 'utf8');
}
