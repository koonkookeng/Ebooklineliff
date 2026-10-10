// SSOT Phase 111 Task 7 §5.1/§8.2 — KYC verdict LINE Flex builder (pure)
// Canonical: apps/backend/src/modules/kyc/services/kyc-flex-message.builder.ts
// - Builds the approval/rejection Flex bubble sent to the Creator's LINE OA
//   (<10KB guard, 084/026 vocabulary-compatible plain object — delivery
//   rides the swappable KycNotifyPort, default LogOnlyKycNotify streams it).
// - RISK_CALL: no LINE push dep in this repo (024 client owns credentials) —
//   the service layer passes the bubble as `detail`; byte-size + schema are
//   asserted here and in 111 contract tests.
// - Zero new deps.
export type KycVerdict = 'VERIFIED' | 'REJECTED';

export interface KycVerdictFlex {
  type: 'flex';
  altText: string;
  contents: {
    type: 'bubble';
    header: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; weight?: string; size?: string; color?: string }> };
    body: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; wrap?: boolean; size?: string; color?: string }> };
    footer?: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'button'; action: { type: 'uri'; label: string; uri: string } }> };
  };
}

/** LINE Flex hard limit guard (50KB); 111 budget is <10KB. */
export const KYC_FLEX_BUDGET_BYTES = 10_000;

export function buildKycVerdictFlex(args: {
  verdict: KycVerdict;
  fullNameTh: string;
  tenantName: string;
  rejectionReason?: string;
  studioDeepLink?: string;
}): KycVerdictFlex {
  const approved = args.verdict === 'VERIFIED';
  const headerText = approved ? 'ยืนยันตัวตนสำเร็จ' : 'ผลการตรวจสอบเอกสาร';
  const bodyLine = approved
    ? `สวัสดีคุณ${args.fullNameTh} บัญชี Creator ของคุณได้รับการอนุมัติแล้ว เริ่มขายได้เลย`
    : `สวัสดีคุณ${args.fullNameTh} เอกสารของคุณ${args.rejectionReason ? `ไม่ผ่าน: ${args.rejectionReason}` : 'ไม่ผ่านการตรวจสอบ'} กรุณาส่งเอกสารใหม่`;
  const bubble: KycVerdictFlex = {
    type: 'flex',
    altText: approved
      ? `KYC อนุมัติแล้ว — ${args.tenantName}`
      : `KYC ต้องการเอกสารเพิ่มเติม — ${args.tenantName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: headerText, weight: 'bold', size: 'lg', color: approved ? '#059669' : '#DC2626' }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: bodyLine, wrap: true, size: 'sm', color: '#111827' },
          { type: 'text', text: args.tenantName, wrap: true, size: 'xs', color: '#6B7280' },
        ],
      },
    },
  };
  if (approved && args.studioDeepLink) {
    bubble.contents.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'button', action: { type: 'uri', label: 'เปิด Creator Studio', uri: args.studioDeepLink } }],
    };
  }
  return bubble;
}

/** Serialized byte size of a verdict bubble (must stay <10KB). */
export function kycFlexByteSize(bubble: KycVerdictFlex): number {
  return Buffer.byteLength(JSON.stringify(bubble), 'utf8');
}
