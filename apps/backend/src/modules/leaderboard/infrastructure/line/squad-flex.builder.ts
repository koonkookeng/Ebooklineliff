// SSOT Phase 096 Task 6 — Squad invite Flex card builder (pure JSON)
// Canonical: apps/backend/src/modules/leaderboard/infrastructure/line/squad-flex.builder.ts
// - Bubble: squad name, points, join CTA deep-link. Zero new deps.
export function buildSquadInviteFlex(args: {
  squadName: string;
  totalPoints: number;
  inviteUrl: string;
}): Record<string, unknown> {
  return {
    type: 'flex',
    altText: `มาร่วมกลุ่มเรียน "${args.squadName}" กับฉันใน LINE!`,
    contents: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: 'https://cdn.omnichannel.com/assets/squad-banner.png',
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
        action: { type: 'uri', uri: args.inviteUrl },
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'STUDY SQUAD INVITE', weight: 'bold', color: '#1DB446', size: 'sm' },
          { type: 'text', text: args.squadName, weight: 'bold', size: 'xl', margin: 'md', wrap: true },
          { type: 'text', text: `คะแนนกลุ่มปัจจุบัน: ${args.totalPoints.toLocaleString()} Points`, size: 'xs', color: '#aaaaaa' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#00B900',
            action: { type: 'uri', label: 'เข้ากลุ่มเรียนทันที', uri: args.inviteUrl },
          },
        ],
      },
    },
  };
}
