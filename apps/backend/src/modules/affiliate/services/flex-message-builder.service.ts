// SSOT Phase 079 §6.1 — Viral Flex share builder (pure JSON)
// Canonical: apps/backend/src/modules/affiliate/services/flex-message-builder.service.ts
// - buildProductFlexCard: bubble with hero cover, price, CTA to the signed
//   referral URL (§6.1 shape); R2 cover URLs keep egress at 0 (Gate 6).
// - Zero new deps.
import { Injectable } from '@nestjs/common';

export interface FlexProductInput {
  productId: string;
  productTitle: string;
  coverImageUrl: string;
  price: number;
  affiliateCode: string;
  shareUrl: string;
  trackingCode: string;
}

export function buildProductFlexCard(p: FlexProductInput): Record<string, unknown> {
  return {
    type: 'bubble',
    hero: {
      type: 'image',
      url: p.coverImageUrl,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: 'ป้ายยาไอเทมเด็ด!', weight: 'bold', color: '#1DB446', size: 'sm' },
        { type: 'text', text: p.productTitle, weight: 'bold', size: 'xl', margin: 'md', wrap: true },
        {
          type: 'box',
          layout: 'baseline',
          margin: 'md',
          contents: [
            { type: 'text', text: `฿${p.price.toLocaleString('th-TH')}`, size: 'xl', color: '#FF3B30', weight: 'bold' },
            { type: 'text', text: `ref:${p.trackingCode}`, size: 'xs', color: '#aaaaaa' },
          ],
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          action: { type: 'uri', label: 'สั่งซื้อ / อ่านเพิ่มเติม', uri: p.shareUrl },
          style: 'primary',
          color: '#06C755',
        },
      ],
    },
  };
}

@Injectable()
export class FlexMessageBuilderService {
  build(p: FlexProductInput): { flexMessageJson: string; shareUrl: string; trackingCode: string } {
    return {
      flexMessageJson: JSON.stringify({
        type: 'flex',
        altText: `แนะนำสิ่งนี้ให้คุณ: ${p.productTitle}`,
        contents: buildProductFlexCard(p),
      }),
      shareUrl: p.shareUrl,
      trackingCode: p.trackingCode,
    };
  }
}
