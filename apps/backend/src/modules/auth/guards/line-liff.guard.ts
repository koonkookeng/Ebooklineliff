// SSOT Phase 006 §5.1/BDD — LineTokenVerifierGuard: 401 INVALID_LINE_TOKEN on bad/expired tokens
// Reads idToken from GQL args, HTTP body, or Bearer header; attaches req.lineProfile on success.
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { LineVerifierService } from '../services/line-verifier.service';

@Injectable()
export class LineLiffGuard implements CanActivate {
  constructor(private readonly verifier: LineVerifierService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gql = GqlExecutionContext.create(context);
    const gqlCtx = gql.getContext() as
      | { req?: Record<string, unknown>; args?: Record<string, unknown> }
      | undefined;
    const httpReq = context.switchToHttp().getRequest?.() as Record<string, unknown> | undefined;
    const req = (gqlCtx?.req ?? httpReq) as Record<string, unknown> | undefined;
    if (!req) throw new UnauthorizedException('INVALID_LINE_TOKEN');

    const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
    const body = (req['body'] ?? {}) as Record<string, unknown>;
    const gqlArgs = (gql.getArgs() ?? {}) as Record<string, unknown>;
    const raw =
      (gqlArgs['idToken'] as string | undefined) ??
      (body['idToken'] as string | undefined) ??
      headers['authorization']?.replace(/^Bearer /, '') ??
      (body['input'] as { idToken?: string } | undefined)?.idToken;
    if (!raw) throw new UnauthorizedException('INVALID_LINE_TOKEN');

    const profile = await this.verifier.verifyIdToken(raw).catch(() => null);
    if (!profile) throw new UnauthorizedException('INVALID_LINE_TOKEN');
    req['lineProfile'] = profile;
    return true;
  }
}
