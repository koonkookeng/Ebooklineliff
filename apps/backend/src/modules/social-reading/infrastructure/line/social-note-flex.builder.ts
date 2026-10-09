// SSOT Phase 095 Task 7 — Social note Flex card builder (pure JSON)
// Canonical: apps/backend/src/modules/social-reading/infrastructure/line/social-note-flex.builder.ts
// - Bubble: quoted note, page ref, author line, open-reader CTA. Zero new deps.
export function buildSocialNoteFlex(args: {
  content: string;
  pageNumber: number;
  authorName: string;
  readerUrl: string;
}): Record<string, unknown> {
  return {
    type: 'flex',
    altText: `💬 โน้ตหน้า ${args.pageNumber}: ${args.content.slice(0, 60)}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `💬 โน้ตจากหน้า ${args.pageNumber}`, weight: 'bold', color: '#06C755', size: 'xs' },
          { type: 'text', text: `“${args.content}”`, size: 'sm', color: '#333333', wrap: true, margin: 'md' },
          { type: 'text', text: `โดย ${args.authorName}`, size: 'xs', color: '#888888', margin: 'sm' },
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
            action: { type: 'uri', label: 'เปิดอ่านพร้อมโน้ต', uri: args.readerUrl },
          },
        ],
      },
    },
  };
}
