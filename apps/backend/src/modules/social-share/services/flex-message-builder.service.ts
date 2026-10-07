// SSOT Phase 026 Task 3 — LINE Flex Message V2 bubble builder (product share cards)
// Canonical: apps/backend/src/modules/social-share/services/flex-message-builder.service.ts
// (legacy src/backend/modules/social-share/services/flex-message-builder.service.ts)
// - Zero new deps. Cover art served from Cloudflare R2 CDN URLs stored on the
//   product (Gate 6: zero-egress). Contents validated against
//   FlexMessagePayloadSchema (Gate 1); hero image capped at 1024px LINE limit.
// - Tenant banner color threads through the footer button (multi-tenant §2.1).
import { Injectable } from '@nestjs/common';
import { FlexMessagePayloadSchema, type ShareContentType } from '@repo/shared';

export interface ProductFlexBubbleInput {
  productTitle: string;
  coverImageUrl: string;
  price: number;
  discountPrice?: number;
  referrerName: string;
  customQuote?: string;
  deepLinkUrl: string;
  contentType: ShareContentType;
  pageNumber?: number;
  tenantColor?: string;
  tenantBanner?: string;
}

const CONTENT_LABEL: Record<ShareContentType, string> = {
  EBOOK_PAGE: 'E-BOOK',
  EBOOK_SUMMARY: 'E-BOOK',
  COURSE_LESSON: 'คอร์สเรียน',
  CERTIFICATE: 'ประกาศนียบัตร',
  PRODUCT_BUNDLE: 'แพ็กเกจสุดคุ้ม',
};

@Injectable()
export class FlexMessageBuilderService {
  buildProductFlexBubble(input: ProductFlexBubbleInput) {
    const accent = input.tenantColor ?? '#059669';
    const quote =
      input.customQuote ??
      (input.pageNumber ? `กำลังอ่านหน้าที่ ${input.pageNumber} เล่มนี้เด็ดมาก!` : 'อยากให้ลองอ่าน/เรียนด้วยกัน!');
    const bubble = {
      type: 'bubble',
      hero: {
        type: 'image',
        url: input.coverImageUrl,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: CONTENT_LABEL[input.contentType], size: 'xs', color: accent, weight: 'bold' },
          { type: 'text', text: input.productTitle, weight: 'bold', size: 'md', wrap: true, maxLines: 2 },
          { type: 'text', text: `ป้ายยาโดย ${input.referrerName}`, size: 'xs', color: '#94a3b8', wrap: true },
          { type: 'text', text: quote, size: 'sm', color: '#475569', wrap: true, maxLines: 3 },
          ...(input.discountPrice !== undefined
            ? [
                {
                  type: 'box',
                  layout: 'baseline',
                  contents: [
                    { type: 'text', text: `฿${input.discountPrice}`, weight: 'bold', size: 'lg', color: '#dc2626' },
                    { type: 'text', text: `฿${input.price}`, size: 'sm', color: '#94a3b8', decoration: 'line-through' },
                  ],
                },
              ]
            : [{ type: 'text', text: `฿${input.price}`, weight: 'bold', size: 'lg' }]),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: accent,
            action: { type: 'uri', label: 'อ่านตัวอย่างฟรี', uri: input.deepLinkUrl },
          },
        ],
      },
    };
    const payload = {
      type: 'flex' as const,
      altText: `${input.referrerName} แนะนำ: ${input.productTitle}`.slice(0, 400),
      contents: bubble,
    };
    return FlexMessagePayloadSchema.parse(payload);
  }
}
