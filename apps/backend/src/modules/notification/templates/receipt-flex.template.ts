// SSOT Phase 019 §5.2 — Receipt Flex Message builder (pure, testable, no I/O)
// Canonical: apps/backend/src/modules/notification/templates/receipt-flex.template.ts
// (legacy src/backend/modules/notification/templates/receipt-flex.template.ts)
// Budget: JSON payload <10KB (§2.1), compose <100ms. Tenant brand injected.
import { FLEX_MAX_BYTES, type LineReceiptPayload } from '@repo/shared';

const thb = (n: number): string => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;

interface FlexNode {
  type: string;
  [key: string]: unknown;
}

function itemBox(title: string, quantity: number, totalPrice: number): FlexNode {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: `${title} (x${quantity})`, size: 'sm', color: '#555555', flex: 4, wrap: true },
      { type: 'text', text: thb(totalPrice), size: 'sm', color: '#111111', align: 'end', flex: 2 },
    ],
  };
}

export interface FlexMessage {
  type: 'flex';
  altText: string;
  contents: unknown;
}

/** Builds the E-Receipt bubble; throws when the payload exceeds the 10KB budget. */
export function buildReceiptFlexMessage(payload: LineReceiptPayload, brandColor = '#10B981'): FlexMessage {
  const msg: FlexMessage = {
    type: 'flex',
    altText: `ใบเสร็จรับเงินสำหรับคำสั่งซื้อ #${payload.orderNumber}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#111827',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: payload.tenantName.toUpperCase(), weight: 'bold', color: brandColor, size: 'xs', flex: 3 },
              { type: 'text', text: 'E-RECEIPT', weight: 'bold', color: '#FFFFFF', size: 'xs', align: 'end', flex: 2 },
            ],
          },
          { type: 'text', text: thb(payload.netAmount), weight: 'bold', color: '#FFFFFF', size: 'xxl', margin: 'md' },
          { type: 'text', text: `ชำระเรียบร้อยแล้วเมื่อ ${payload.paidAt}`, color: '#9CA3AF', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `เลขที่คำสั่งซื้อ: #${payload.orderNumber}`, size: 'xs', color: '#6B7280', weight: 'bold' },
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            spacing: 'sm',
            contents: payload.items.map((i) => itemBox(i.title, i.quantity, i.totalPrice)),
          },
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            contents: [
              { type: 'text', text: 'รวมทั้งสิ้น (รวม VAT)', size: 'sm', weight: 'bold', color: '#111111' },
              { type: 'text', text: thb(payload.netAmount), size: 'sm', weight: 'bold', color: brandColor, align: 'end' },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: brandColor,
            action: { type: 'uri', label: 'เข้าสู่คลังหนังสือ / คอร์สเรียน', uri: payload.liffRedirectUrl },
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'uri', label: 'ดาวน์โหลดใบเสร็จ (PDF)', uri: payload.pdfDownloadUrl },
          },
        ],
      },
    },
  };
  const bytes = Buffer.byteLength(JSON.stringify(msg), 'utf8');
  if (bytes > FLEX_MAX_BYTES) {
    throw new Error(`Flex payload ${bytes}B exceeds the 10KB budget`);
  }
  return msg;
}
