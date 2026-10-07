// SSOT Phase 036 Task 6 — Edge stream entitlement guard (<50ms gatekeeper)
// Canonical: apps/backend/src/modules/entitlement/guards/edge-stream-entitlement.guard.ts
// (legacy src/backend/modules/entitlement/guards/edge-stream-entitlement.guard.ts)
// - Preview pages 1–10 pass without entitlement (vault + reader rule).
// - Product routes require an active entitlement row, else 403.
// - Lesson-only routes pass authenticated requests through: the vault
//   controller performs the lesson→course→entitlement join (single indexed
//   read) and enforces the final 403 — defense in depth, still <50ms.
// - 403 carries no ownership disclosure (opaque message, Gate 4).
// - Zero new deps.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { R2_PREVIEW_MAX_PAGE } from '@repo/shared';

interface GuardTables {
  entitlement: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
}

interface GuardRequest {
  user?: { id?: string };
  params?: Record<string, string>;
  query?: Record<string, string>;
  streamUserId?: string;
  streamPreview?: boolean;
}

@Injectable()
export class EdgeStreamEntitlementGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<GuardRequest>();
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Unauthorized');
    const page = Number(req.params?.pageNumber ?? req.query?.pageNumber ?? NaN);
    if (Number.isInteger(page) && page >= 1 && page <= R2_PREVIEW_MAX_PAGE) {
      req.streamUserId = userId;
      req.streamPreview = true;
      return true;
    }
    const productId = req.params?.productId ?? req.query?.productId;
    if (!productId) {
      // Lesson-scoped route: controller performs the join + final 403.
      req.streamUserId = userId;
      req.streamPreview = false;
      return true;
    }
    // Entitlement row = grant; expiresAt null = perpetual (schema has no
    // accessGranted flag — Phase 000 shape: accessType + optional expiry).
    const hit = await (this.prisma as unknown as GuardTables).entitlement
      .findFirst({ where: { userId, productId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } })
      .catch(() => null);
    if (!hit) throw new ForbiddenException('Content access denied');
    req.streamUserId = userId;
    req.streamPreview = false;
    return true;
  }
}
