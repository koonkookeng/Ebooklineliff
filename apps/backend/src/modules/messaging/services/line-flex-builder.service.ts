// SSOT Phase 084 Task 5 — Abandoned-cart Flex card builder (pure JSON)
// Canonical: apps/backend/src/modules/messaging/services/line-flex-builder.service.ts
// - Mega bubble: hero cover, greeting, item rows (max 3 + overflow line),
//   total/discount baseline, countdown + 1-click recovery CTA (BDD-1).
//   Covers stay on R2 CDN (Gate 6); caller passes resized URLs.
// - Zero new deps.
import { Injectable } from '@nestjs/common';

export interface AbandonedFlexItem {
  productTitle: string;
  coverImageUrl: string;
  price: number;
  quantity: number;
}

export function buildAbandonedCartFlex(args: {
  userName: string;
  items: AbandonedFlexItem[];
  totalAmount: number;
  discountAmount: number;
  couponCode: string;
  countdownSec: number;
  recoveryUrl: string;
}): Record<string, unknown> {
  const shown = args.items.slice(0, 3);
  const overflow = args.items.length - shown.length;
  const mm = Math.floor(args.countdownSec / 60);
  const ss = args.countdownSec % 60;
  return {
    type: 'flex',
    altText: `🛒 ${args.userName} มีสินค้าค้างในตะกร้า! รับส่วนลดพิเศษ`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: shown[0]?.coverImageUrl ?? '',
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
        action: { type: 'uri', uri: args.recoveryUrl },
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `🛒 ${args.userName} ลืมอะไรไว้หรือเปล่า?`, weight: 'bold', color: '#F97316', size: 'sm', wrap: true },
          ...shown.map((i) => ({
            type: 'box',
            layout: 'baseline',
            margin: 'sm',
            contents: [
              { type: 'text', text: i.productTitle.slice(0, 24), size: 'sm', flex: 4, wrap: true },
              { type: 'text', text: `x${i.quantity}`, size: 'sm', color: '#888888', flex: 1, align: 'end' },
              { type: 'text', text: `฿${(i.price * i.quantity).toLocaleString('th-TH')}`, size: 'sm', weight: 'bold', flex: 2, align: 'end' },
            ],
          })),
          ...(overflow > 0 ? [{ type: 'text', text: `+ อีก ${overflow} รายการ`, size: 'xs', color: '#888888', margin: 'xs' }] : []),
          {
            type: 'box',
            layout: 'baseline',
            margin: 'lg',
            contents: [
              { type: 'text', text: `฿${args.totalAmount.toLocaleString('th-TH')}`, size: 'sm', color: '#AAAAAA', decoration: 'line-through', flex: 2 },
              { type: 'text', text: `฿${(args.totalAmount - args.discountAmount).toLocaleString('th-TH')}`, weight: 'bold', size: 'xxl', color: '#1DB446', flex: 3, align: 'end' },
            ],
          },
          { type: 'text', text: `คูปอง ${args.couponCode} หมดใน ${mm}:${String(ss).padStart(2, '0')} ชม:นาที`, size: 'xs', color: '#F59E0B', weight: 'bold', margin: 'sm' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#06C755',
            action: { type: 'uri', label: 'กู้คืนตะกร้า & รับส่วนลด', uri: args.recoveryUrl },
          },
        ],
      },
    },
  };
}

@Injectable()
export class LineFlexBuilderService {
  build(args: {
    userName: string;
    items: AbandonedFlexItem[];
    totalAmount: number;
    discountAmount: number;
    couponCode: string;
    countdownSec: number;
    recoveryUrl: string;
  }): { flexMessageJson: string } {
    return { flexMessageJson: JSON.stringify(buildAbandonedCartFlex(args)) };
  }
}
