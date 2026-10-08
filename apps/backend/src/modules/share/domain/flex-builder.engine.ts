// SSOT Phase 080 §5.2 — LINE Flex mega-bubble card builder (pure JSON)
// Canonical: apps/backend/src/modules/share/domain/flex-builder.engine.ts
// - buildShareFlexCard: spec-§5.2 shape (mega bubble, hero cover with URI
//   action, badge + title + description, price/discount baseline, footer CTA).
//   Tenant theme injects via primaryColor (§2.1 multi-tenant flex engine).
// - Covers stay on Cloudflare R2 / Image Resizer CDN (Gate 6 zero-egress);
//   caller passes the resized (<200KB WebP) URL — this engine never fetches.
// - Zero new deps.
import { Injectable } from '@nestjs/common';

export interface ShareFlexCardInput {
  title: string;
  description: string;
  coverImageUrl: string;
  price: number;
  discountPrice?: number;
  productType: string;
  referralUrl: string;
  affiliateCode: string;
  primaryColor?: string;
}

const MAX_FLEX_BYTES = 50 * 1024;

export function buildShareFlexCard(p: ShareFlexCardInput): Record<string, unknown> {
  const themeColor = p.primaryColor || '#050505';
  const hasDiscount =
    typeof p.discountPrice === 'number' && p.discountPrice < p.price && p.discountPrice > 0;
  const badge = p.productType.replace(/_/g, ' ');
  return {
    type: 'flex',
    altText: `🎁 มีของดีมาป้ายยา! ${p.title}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: p.coverImageUrl,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
        action: { type: 'uri', uri: p.referralUrl },
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: badge, color: '#FFFFFF', size: 'xs', weight: 'bold' },
          { type: 'text', text: p.title, weight: 'bold', size: 'xl', wrap: true, margin: 'md' },
          {
            type: 'text',
            text: p.description,
            size: 'xs',
            color: '#666666',
            wrap: true,
            maxLines: 2,
            margin: 'xs',
          },
          {
            type: 'box',
            layout: 'baseline',
            margin: 'lg',
            contents: [
              {
                type: 'text',
                text: `฿${(hasDiscount ? (p.discountPrice as number) : p.price).toLocaleString('th-TH')}`,
                weight: 'bold',
                size: 'xxl',
                color: '#1DB446',
              },
              ...(hasDiscount
                ? [
                    {
                      type: 'text',
                      text: `฿${p.price.toLocaleString('th-TH')}`,
                      size: 'sm',
                      color: '#AAAAAA',
                      decoration: 'line-through',
                      margin: 'md',
                    },
                  ]
                : []),
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
            color: themeColor,
            action: { type: 'uri', label: '📖 ดูรายละเอียด / ทดลองอ่าน', uri: p.referralUrl },
          },
        ],
      },
    },
  };
}

/** Guard: Flex payload must fit the LINE 50KB message ceiling. */
export function assertFlexSize(flexMessageJson: string): void {
  if (Buffer.byteLength(flexMessageJson, 'utf8') > MAX_FLEX_BYTES) {
    throw new Error('Flex payload exceeds LINE 50KB ceiling');
  }
}

@Injectable()
export class FlexBuilderEngine {
  build(p: ShareFlexCardInput): { flexMessageJson: string } {
    const flexMessageJson = JSON.stringify(buildShareFlexCard(p));
    assertFlexSize(flexMessageJson);
    return { flexMessageJson };
  }
}
