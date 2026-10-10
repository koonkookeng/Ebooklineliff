// SSOT Phase 118 Task 7 §7 — audit LINE Flex builder (pure)
// Canonical: apps/backend/src/modules/audit-log/application/audit-flex.builder.ts
// - Builds tamper-incident + chain-verified bubbles (<10KB guard, 084/111-118
//   vocabulary-compatible plain objects — delivery rides the swappable
//   AuditNotifyPort, default LogOnly streams it).
// - RISK_CALL: no LINE push dep in this repo (024 client owns credentials).
// - Zero new deps.
export type AuditOutcome = 'TAMPER_DETECTED' | 'CHAIN_VERIFIED';

export interface AuditFlex {
  type: 'flex';
  altText: string;
  contents: {
    type: 'bubble';
    header: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; weight?: string; size?: string; color?: string }> };
    body: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; wrap?: boolean; size?: string; color?: string }> };
  };
}

/** LINE Flex hard limit guard (50KB); 118 budget is <10KB. */
export const AUDIT_FLEX_BUDGET_BYTES = 10_000;

export function buildAuditFlex(args: {
  outcome: AuditOutcome;
  tenantName: string;
  brokenAt?: number | bigint | string;
  checked?: number;
}): AuditFlex {
  const title = args.outcome === 'TAMPER_DETECTED' ? 'CRITICAL: ตรวจพบการปลอมแปลง Audit Log' : 'ตรวจสอบ Hash Chain ผ่าน';
  const lines = [title];
  if (args.brokenAt !== undefined) lines.push(`block เสียหายที่ลำดับ ${String(args.brokenAt)}`);
  if (args.checked !== undefined) lines.push(`ตรวจสอบ ${args.checked} บล็อก`);
  lines.push(args.tenantName);
  return {
    type: 'flex',
    altText: `${title} — ${args.tenantName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: title, weight: 'bold', size: 'lg', color: args.outcome === 'TAMPER_DETECTED' ? '#DC2626' : '#059669' }],
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

/** Serialized byte size of an audit bubble (must stay <10KB). */
export function auditFlexByteSize(bubble: AuditFlex): number {
  return Buffer.byteLength(JSON.stringify(bubble), 'utf8');
}
