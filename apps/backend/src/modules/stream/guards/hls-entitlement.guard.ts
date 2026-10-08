// SSOT Phase 053 §5.1 — HLS entitlement guard (lessonId present + JWT identity)
// Canonical: apps/backend/src/modules/stream/guards/hls-entitlement.guard.ts
// (legacy src/backend/modules/stream/guards/hls-entitlement.guard.ts)
// - Runs AFTER JwtAuthGuard (which populates request.user); this guard only
//   asserts an authenticated identity + a lessonId scope (query or param).
// - Carries Nest decorators → verified via static parity (Phase 027+ precedent).
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

interface HlsGuardRequest {
  user?: { id?: string };
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

@Injectable()
export class HlsEntitlementGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<HlsGuardRequest>();
    if (!req.user?.id) {
      throw new UnauthorizedException('Missing stream identity');
    }
    const lessonId = req.query?.['lessonId'] ?? req.params?.['lessonId'];
    if (typeof lessonId !== 'string' || lessonId.length === 0) {
      throw new UnauthorizedException('Missing lesson scope');
    }
    return true;
  }
}
