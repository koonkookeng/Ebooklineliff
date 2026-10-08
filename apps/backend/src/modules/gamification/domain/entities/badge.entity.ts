// SSOT Phase 083 §5.1 — Badge entity guards (threshold evaluation)
// Canonical: apps/backend/src/modules/gamification/domain/entities/badge.entity.ts
// - A badge unlocks when the measured stat meets its threshold; unlocks are
//   unique per (user, badge) — replays return the existing row.
// - Zero new deps.
import { BadRequestException } from '@nestjs/common';

export interface BadgeRule {
  id: string;
  code: string;
  name: string;
  description: string;
  iconUrl: string;
  category: string;
  criteriaType: string;
  criteriaThreshold: number;
  pointsReward: number;
}

/** True when the user's stat satisfies the badge rule. */
export function isBadgeEarned(rule: Pick<BadgeRule, 'criteriaThreshold'>, statValue: number): boolean {
  return statValue >= rule.criteriaThreshold;
}

export function assertRedemptionCover(walletPoints: number, pointsRequired: number): void {
  if (walletPoints < pointsRequired) {
    throw new BadRequestException('คะแนนสะสมของคุณไม่เพียงพอสำหรับการแลก');
  }
}

/** Viral badge Flex card (1-click LINE share, BDD-3/Task 7). R2 icon, zero-egress. */
export function buildBadgeFlexCard(args: {
  badgeName: string;
  badgeDescription: string;
  iconUrl: string;
  streakDays: number;
}): Record<string, unknown> {
  return {
    type: 'flex',
    altText: `🏆 ปลดล็อก Badge: ${args.badgeName}`,
    contents: {
      type: 'bubble',
      hero: { type: 'image', url: args.iconUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🏆 ปลดล็อกความสำเร็จ!', weight: 'bold', color: '#F59E0B', size: 'sm' },
          { type: 'text', text: args.badgeName, weight: 'bold', size: 'xl', margin: 'md', wrap: true },
          { type: 'text', text: args.badgeDescription, size: 'xs', color: '#666666', wrap: true, margin: 'xs' },
          { type: 'text', text: `Streak ${args.streakDays} วัน — มาร่วมสะสมกัน!`, size: 'xs', color: '#10B981', margin: 'md' },
        ],
      },
    },
  };
}
