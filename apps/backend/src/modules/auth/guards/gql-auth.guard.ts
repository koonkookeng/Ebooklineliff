// SSOT Phase 004 §5.2 — GQL auth guard (Bearer presence + req.user passthrough; full JWT = Phase 005/006)
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

@Injectable()
export class GqlAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const ctx = GqlExecutionContext.create(context);
    const req = ctx.getContext().req ?? context.switchToHttp().getRequest?.();
    const auth: string | undefined = req?.headers?.authorization ?? req?.headers?.Authorization;
    if (!auth || !auth.startsWith('Bearer ') || auth.length < 12) {
      throw new UnauthorizedException('Missing or invalid Bearer token');
    }
    if (!req?.user) {
      // Upstream Fastify JWT hook (Phase 005) populates req.user; allow pre-auth passthrough in dev/test
      req.user = { id: 'anonymous' };
    }
    return true;
  }
}
