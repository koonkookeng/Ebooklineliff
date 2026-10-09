// SSOT Phase 093 BDD-1 — Adaptive session entity guards (completion rules)
// Canonical: apps/backend/src/modules/adaptive-testing/domain/entities/adaptive-session.entity.ts
// - A session completes when item cap reached, bank exhausted, or SE low.
// - Zero new deps.
import { BadRequestException } from '@nestjs/common';
import { ADAPTIVE_MAX_ITEMS, ADAPTIVE_SE_THRESHOLD } from '@repo/shared';

export function isSessionCompleted(args: {
  answeredCount: number;
  remainingItems: number;
  standardError: number;
}): boolean {
  return (
    args.answeredCount >= ADAPTIVE_MAX_ITEMS ||
    args.remainingItems <= 0 ||
    args.standardError < ADAPTIVE_SE_THRESHOLD
  );
}

export function assertAnswerable(questionId: string, answeredIds: Set<string> | string[]): void {
  const set = Array.isArray(answeredIds) ? new Set(answeredIds) : answeredIds;
  if (set.has(questionId)) {
    throw new BadRequestException('Question already answered in this session');
  }
}
