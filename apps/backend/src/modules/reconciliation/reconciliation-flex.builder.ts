// SSOT Phase 115 Task 8 §7.1 — reconciliation LINE Flex builder (pure)
// Canonical: apps/backend/src/modules/reconciliation/reconciliation-flex.builder.ts
// - Builds payment-receipt / discrepancy / override / duplicate bubbles
//   (<10KB guard, 084/111-114 vocabulary-compatible plain objects — delivery
//   rides the swappable ReconciliationNotifyPort, default LogOnly streams it).
// - RISK_CALL: no LINE push dep in this repo (024 client owns credentials).
// - Zero new deps.
export type ReconOutcome = 'RECEIPT' | 'DISCREPANCY' | 'OVERRIDE_OK' | 'OVERRIDE_PENDING' | 'DUPLICATE';

export interface ReconFlex {
  type: 'flex';
  altText: string;
  contents: {
    type: 'bubble';
    header: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; weight?: string; size?: string; color?: string }> };
    body: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; wrap?: boolean; size?: string; color?: string }> };
  };
}

/** LINE Flex hard limit guard (50KB); 115 budget is <10KB. */
export const RECON_FLEX_BUDGET_BYTES = 10_000;

const HEADER_COLOR: Record<ReconOutcome, string> = {
  RECEIPT: '#059669',
  DISCREPANCY: '#D97706',
  OVERRIDE_OK: '#2563EB',
  OVERRIDE_PENDING: '#D97706',
  DUPLICATE: '#6B7280',
};

const HEADER_TEXT: Record<ReconOutcome, string> = {
  RECEIPT: 'ชำระเงินสำเร็จ',
  DISCREPANCY: 'พบยอดเงินไม่ตรง',
  OVERRIDE_OK: 'ปรับรายการสำเร็จ',
  OVERRIDE_PENDING: 'รอ Checker อนุมัติ',
  DUPLICATE: 'รายการซ้ำ',
};

const thb = (n: number): string => `฿${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildReconFlex(args: {
  outcome: ReconOutcome;
  amountThb: number;
  tenantName: string;
  ref?: string;
  detail?: string;
}): ReconFlex {
  const lines = [`${HEADER_TEXT[args.outcome]} ${thb(args.amountThb)}`];
  if (args.ref) lines.push(`ref ${args.ref}`);
  if (args.detail) lines.push(args.detail);
  lines.push(args.tenantName);
  return {
    type: 'flex',
    altText: `${HEADER_TEXT[args.outcome]} ${thb(args.amountThb)} — ${args.tenantName}`,
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
}

/** Serialized byte size of a recon bubble (must stay <10KB). */
export function reconFlexByteSize(bubble: ReconFlex): number {
  return Buffer.byteLength(JSON.stringify(bubble), 'utf8');
}
