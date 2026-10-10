// SSOT Phase 113 Task 8 §5.1 — dispute LINE Flex builder (pure)
// Canonical: apps/backend/src/modules/dispute/dispute-flex.builder.ts
// - Builds FILED / SELLER_RESPONSE / REFUND_APPROVED / RELEASED_SELLER /
//   CANCELLED / ESCROW_RELEASED bubbles (<10KB guard, 084/111/112
//   vocabulary-compatible plain objects — delivery rides the swappable
//   DisputeNotifyPort, default LogOnly streams it).
// - RISK_CALL: no LINE push dep in this repo (024 client owns credentials).
// - Zero new deps.
export type DisputeOutcome = 'FILED' | 'SELLER_RESPONSE' | 'REFUND_APPROVED' | 'RELEASED_SELLER' | 'CANCELLED' | 'ESCROW_RELEASED';

export interface DisputeFlex {
  type: 'flex';
  altText: string;
  contents: {
    type: 'bubble';
    header: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; weight?: string; size?: string; color?: string }> };
    body: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; wrap?: boolean; size?: string; color?: string }> };
    footer?: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'button'; action: { type: 'uri'; label: string; uri: string } }> };
  };
}

/** LINE Flex hard limit guard (50KB); 113 budget is <10KB. */
export const DISPUTE_FLEX_BUDGET_BYTES = 10_000;

const HEADER_COLOR: Record<DisputeOutcome, string> = {
  FILED: '#D97706',
  SELLER_RESPONSE: '#2563EB',
  REFUND_APPROVED: '#059669',
  RELEASED_SELLER: '#059669',
  CANCELLED: '#6B7280',
  ESCROW_RELEASED: '#059669',
};

const HEADER_TEXT: Record<DisputeOutcome, string> = {
  FILED: 'ได้รับข้อพิพาทใหม่',
  SELLER_RESPONSE: 'ผู้ขายตอบกลับข้อพิพาท',
  REFUND_APPROVED: 'อนุมัติคืนเงินแล้ว',
  RELEASED_SELLER: 'ปล่อยเงินให้ผู้ขายแล้ว',
  CANCELLED: 'ยกเลิกข้อพิพาทแล้ว',
  ESCROW_RELEASED: 'ปล่อยเงิน Escrow แล้ว',
};

export function buildDisputeFlex(args: {
  outcome: DisputeOutcome;
  disputeNo: string;
  tenantName: string;
  amountThb?: number;
  detail?: string;
  disputeDeepLink?: string;
}): DisputeFlex {
  const lines = [`คำร้อง ${args.disputeNo} — ${HEADER_TEXT[args.outcome]}`];
  if (typeof args.amountThb === 'number') lines.push(`ยอดเงิน ฿${args.amountThb.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  if (args.detail) lines.push(args.detail);
  lines.push(args.tenantName);
  const bubble: DisputeFlex = {
    type: 'flex',
    altText: `${HEADER_TEXT[args.outcome]} ${args.disputeNo} — ${args.tenantName}`,
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
  if ((args.outcome === 'FILED' || args.outcome === 'SELLER_RESPONSE' || args.outcome === 'REFUND_APPROVED') && args.disputeDeepLink) {
    const label = args.outcome === 'REFUND_APPROVED' ? 'ดูยอดคืนในวอลเล็ต' : 'ดูรายละเอียดข้อพิพาท';
    bubble.contents.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'button', action: { type: 'uri', label, uri: args.disputeDeepLink } }],
    };
  }
  return bubble;
}

/** Serialized byte size of a dispute bubble (must stay <10KB). */
export function disputeFlexByteSize(bubble: DisputeFlex): number {
  return Buffer.byteLength(JSON.stringify(bubble), 'utf8');
}
