// SSOT Phase 027 §5.1 — LIFF session guard (tenant-hinted edge auth)
// Canonical: apps/backend/src/modules/navigation/guards/liff-session.guard.ts
// (legacy src/backend/modules/navigation/guards/liff-session.guard.ts)
// - Passes when the request carries any LIFF identity signal: Authorization bearer
//   (JwtAuthGuard primary path), x-liff-id, or x-line-user-id edge headers.
// - Strict 401 otherwise (no fail-open on identity; fail-open only on Redis edge).
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

interface GuardReq {
  headers?: Record<string, string | string[] | undefined>;
}

function header(req: GuardReq, name: string): string | undefined {
  const v = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

@Injectable()
export class LiffSessionGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<GuardReq & { user?: { id?: string } }>();
    if (req.user?.id) return true;
    const auth = header(req, 'authorization');
    const liffId = header(req, 'x-liff-id');
    const lineUserId = header(req, 'x-line-user-id');
    if ((auth && auth.startsWith('Bearer ') && auth.length > 8) || liffId || lineUserId) return true;
    throw new UnauthorizedException('Missing LIFF session identity');
  }
}
