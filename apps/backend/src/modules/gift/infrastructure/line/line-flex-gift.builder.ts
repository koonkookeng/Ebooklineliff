// SSOT Phase 089 Task 3 — Gift Flex card builder (pure JSON)
// Canonical: apps/backend/src/modules/gift/infrastructure/line/line-flex-gift.builder.ts
// - Bubble: hero cover, theme ribbon, greeting (≤500 chars), sender line,
//   claim CTA deep-link. Covers on R2 (Gate 6).
// - Zero new deps.
import { Injectable } from '@nestjs/common';

const THEME_ACCENT: Record<string, string> = {
  BIRTHDAY_CELEBRATION: '#F59E0B',
  NEW_YEAR_GOALS: '#10B981',
  CONGRATULATIONS: '#8B5CF6',
  THANK_YOU: '#06C755',
  CUSTOM_BRANDED: '#0EA5E9',
};

export function buildGiftFlexCard(args: {
  productTitle: string;
  coverImageUrl: string;
  greetingTheme: string;
  greetingMessage: string;
  senderName: string;
  claimUrl: string;
}): Record<string, unknown> {
  return {
    type: 'flex',
    altText: `🎁 คุณได้รับของขวัญ: ${args.productTitle}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: args.coverImageUrl,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
        action: { type: 'uri', uri: args.claimUrl },
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🎁 คุณได้รับของขวัญ!', weight: 'bold', color: THEME_ACCENT[args.greetingTheme] ?? '#F59E0B', size: 'sm' },
          { type: 'text', text: args.productTitle, weight: 'bold', size: 'xl', margin: 'md', wrap: true },
          { type: 'text', text: `“${args.greetingMessage}”`, size: 'sm', color: '#555555', wrap: true, margin: 'md' },
          { type: 'text', text: `จาก ${args.senderName}`, size: 'xs', color: '#888888', margin: 'sm' },
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
            action: { type: 'uri', label: '🎁 กดรับของขวัญ', uri: args.claimUrl },
          },
        ],
      },
    },
  };
}

@Injectable()
export class LineFlexGiftBuilder {
  build(args: {
    productTitle: string;
    coverImageUrl: string;
    greetingTheme: string;
    greetingMessage: string;
    senderName: string;
    claimUrl: string;
  }): { flexMessageJson: string } {
    return { flexMessageJson: JSON.stringify(buildGiftFlexCard(args)) };
  }
}
