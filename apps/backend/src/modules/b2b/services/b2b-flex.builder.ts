// SSOT Phase 097 Task 6 — Corporate onboarding Flex card builder (pure JSON)
// Canonical: apps/backend/src/modules/b2b/services/b2b-flex.builder.ts
// - Co-located pure builder (spec tree has no infra/ — zero-dep).
export function buildCorporateOnboardingFlex(args: {
  companyName: string;
  totalSeats: number;
  claimUrl: string;
}): Record<string, unknown> {
  return {
    type: 'flex',
    altText: `🏢 ${args.companyName} มอบสิทธิ์เข้าเรียน ${args.totalSeats} ที่นั่ง`,
    contents: {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'CORPORATE LEARNING INVITE', weight: 'bold', color: '#0EA5E9', size: 'xs' },
          { type: 'text', text: args.companyName, weight: 'bold', size: 'xl', margin: 'md', wrap: true },
          { type: 'text', text: `กดรับสิทธิ์เข้าเรียน ${args.totalSeats} ที่นั่งสำหรับพนักงาน`, size: 'sm', color: '#555555', wrap: true, margin: 'md' },
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
            action: { type: 'uri', label: 'รับสิทธิ์พนักงาน', uri: args.claimUrl },
          },
        ],
      },
    },
  };
}
