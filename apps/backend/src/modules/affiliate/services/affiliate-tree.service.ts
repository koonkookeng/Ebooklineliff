// SSOT Phase 079 Task 2 — Affiliate ancestor tree (3-tier resolve)
// Canonical: apps/backend/src/modules/affiliate/services/affiliate-tree.service.ts
// - ancestorsOf: walk referredById up to 3 hops; circular/self chains are
//   cut (§10 Recursive Commission Lock Test) — never infinite.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { assertAcyclic } from '../domain/affiliate.entity';
import type { AffiliateRepository, AffiliateUserRow } from '../domain/affiliate.repository';

export interface TierAncestor {
  tier: 'TIER_1_DIRECT' | 'TIER_2_INDIRECT' | 'TIER_3_COMMUNITY';
  user: AffiliateUserRow;
}

@Injectable()
export class AffiliateTreeService {
  constructor(private readonly repo: AffiliateRepository) {}

  /** Resolve up to 3 ancestors for a buyer (cycle-safe). */
  async ancestorsOf(buyerId: string): Promise<TierAncestor[]> {
    const tiers = ['TIER_1_DIRECT', 'TIER_2_INDIRECT', 'TIER_3_COMMUNITY'] as const;
    const out: TierAncestor[] = [];
    const seen = new Set<string>([buyerId]);
    let cursor: string | null = buyerId;

    for (let i = 0; i < 3; i++) {
      const current = cursor === buyerId
        ? await this.repo.findUser(buyerId)
        : await this.repo.findUser(cursor as string);
      const parentId = current?.referredById ?? null;
      if (!parentId || seen.has(parentId)) break;
      const parent = await this.repo.findUser(parentId);
      if (!parent) break;
      seen.add(parent.id);
      out.push({ tier: tiers[i] as TierAncestor['tier'], user: parent });
      cursor = parent.id;
    }

    assertAcyclic(buyerId, out.map((a) => ({ id: a.user.id })));
    return out;
  }
}
