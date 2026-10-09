// SSOT Phase 090 Task 5 — Group invite Flex card builder (pure JSON)
// Canonical: apps/backend/src/modules/group-buying/infrastructure/line/line-flex-group.builder.ts
// - Bubble: hero cover, group-type ribbon, strike-through pricing, remaining
//   slots line, join CTA deep-link. Covers on R2 (Gate 6).
// - Zero new deps.
import { Injectable } from '@nestjs/common';

const GROUP_ACCENT: Record<string, string> = {
  BUDDY_PASS_2P: '#06C755',
  GROUP_BUY_3P: '#10B981',
  GROUP_BUY_5P: '#8B5CF6',
  CORPORATE_TEAM: '#0EA5E9',
};

const GROUP_LABEL: Record<string, string> = {
  BUDDY_PASS_2P: 'BUDDY PASS (ซื้อคู่ถูกกว่า)',
  GROUP_BUY_3P: 'GROUP BUY 3 คน',
  GROUP_BUY_5P: 'GROUP BUY 5 คน',
  CORPORATE_TEAM: 'CORPORATE TEAM',
};

export function buildGroupInviteFlex(args: {
  productTitle: string;
  coverImageUrl: string;
  groupType: string;
  discountedPrice: number;
  originalPrice: number;
  currentMembers: number;
  requiredMembers: number;
  inviteUrl: string;
}): Record<string, unknown> {
  const remaining = Math.max(0, args.requiredMembers - args.currentMembers);
  return {
    type: 'flex',
    altText: `🔥 ชวนคุณมาหารคู่! ${args.productTitle} เหลือเพียง ฿${args.discountedPrice}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: args.coverImageUrl,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
        action: { type: 'uri', uri: args.inviteUrl },
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: GROUP_LABEL[args.groupType] ?? 'GROUP BUY', weight: 'bold', color: GROUP_ACCENT[args.groupType] ?? '#06C755', size: 'xs' },
          { type: 'text', text: args.productTitle, weight: 'bold', size: 'xl', margin: 'md', wrap: true },
          {
            type: 'box',
            layout: 'baseline',
            margin: 'md',
            contents: [
              { type: 'text', text: `฿${args.discountedPrice}`, size: '2xl', weight: 'bold', color: '#E53E3E' },
              { type: 'text', text: `฿${args.originalPrice}`, size: 'sm', color: '#AAAAAA', decoration: 'line-through', margin: 'md' },
            ],
          },
          { type: 'text', text: `ต้องการอีกเพียง ${remaining} คนเพื่อปลดล็อกสิทธิ์!`, size: 'sm', color: '#555555', margin: 'md' },
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
            action: { type: 'uri', label: 'เข้าร่วมกลุ่มรับส่วนลดทันที', uri: args.inviteUrl },
          },
        ],
      },
    },
  };
}

@Injectable()
export class LineFlexGroupBuilder {
  build(args: {
    productTitle: string;
    coverImageUrl: string;
    groupType: string;
    discountedPrice: number;
    originalPrice: number;
    currentMembers: number;
    requiredMembers: number;
    inviteUrl: string;
  }): { flexMessageJson: string } {
    return { flexMessageJson: JSON.stringify(buildGroupInviteFlex(args)) };
  }
}
