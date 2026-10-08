// SSOT Phase 083 BDD-3 — Badge evaluator (stat → unlock set)
// Canonical: apps/backend/src/modules/gamification/domain/services/badge-evaluator.service.ts
// - evaluate: for each rule, compare the matching stat; returns the newly
//   earned rules (persistence + idempotency live in the use-case).
// - Seed catalog (§4.1 shapes): Master Reader (100 pages), Week Warrior
//   (7-day streak), Month Master (30-day streak).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { isBadgeEarned, type BadgeRule } from '../entities/badge.entity';

export interface UserStats {
  readPages: number;
  streakDays: number;
  purchaseCount: number;
}

export const SEED_BADGES: Array<{
  code: string;
  name: string;
  description: string;
  iconUrl: string;
  category: string;
  criteriaType: string;
  criteriaThreshold: number;
  pointsReward: number;
}> = [
  {
    code: 'MASTER_READER',
    name: 'Master Reader',
    description: 'อ่านครบ 100 หน้า',
    iconUrl: 'https://r2.example.com/badges/master-reader.webp',
    category: 'READING_MILESTONE',
    criteriaType: 'READ_PAGES',
    criteriaThreshold: 100,
    pointsReward: 500,
  },
  {
    code: 'WEEK_WARRIOR',
    name: 'Week Warrior',
    description: 'เช็กอินต่อเนื่อง 7 วัน',
    iconUrl: 'https://r2.example.com/badges/week-warrior.webp',
    category: 'LEARNING_STREAK',
    criteriaType: 'STREAK_DAYS',
    criteriaThreshold: 7,
    pointsReward: 200,
  },
  {
    code: 'MONTH_MASTER',
    name: 'Month Master',
    description: 'เช็กอินต่อเนื่อง 30 วัน',
    iconUrl: 'https://r2.example.com/badges/month-master.webp',
    category: 'LEARNING_STREAK',
    criteriaType: 'STREAK_DAYS',
    criteriaThreshold: 30,
    pointsReward: 1000,
  },
];

function statFor(criteriaType: string, stats: UserStats): number {
  switch (criteriaType) {
    case 'READ_PAGES':
      return stats.readPages;
    case 'STREAK_DAYS':
      return stats.streakDays;
    case 'PURCHASE_COUNT':
      return stats.purchaseCount;
    default:
      return 0;
  }
}

@Injectable()
export class BadgeEvaluatorService {
  evaluate(
    rules: BadgeRule[],
    stats: UserStats,
    unlockedIds: Set<string>,
  ): BadgeRule[] {
    return rules.filter(
      (r) => !unlockedIds.has(r.id) && isBadgeEarned(r, statFor(r.criteriaType, stats)),
    );
  }
}
