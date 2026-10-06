// SSOT Phase 005 §3.2 — Auth GraphQL intents (LINE LIFF / Web OAuth / refresh / logout)
// Delegates to AuthService (single logic point); Phase 004 accessToken alias retained.
import { Resolver, Mutation, Args, Context } from '@nestjs/graphql';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthenticateLineLiffInputSchema } from '@repo/shared';
import { AuthService } from '../../../modules/auth/services/auth.service';
import type { GraphQLContext } from '../context/graphql-context.factory';

interface AuthUserShape {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  lineUserId: string | null;
  role: string;
}

function toPayload(
  result: {
    accessToken: string;
    expiresIn: number;
    user: AuthUserShape;
    sessionId: string;
  },
  tenantId: string,
) {
  const user = { ...result.user, tenantId };
  return {
    accessToken: result.accessToken,
    expiresIn: result.expiresIn,
    user,
    // Deprecated Phase 004 compat fields
    token: result.accessToken,
    userId: result.user.id,
  };
}

function reqMeta(ctx: GraphQLContext): { clientIp: string; userAgent: string } {
  return {
    clientIp: ctx.req.ip ?? 'unknown',
    userAgent: ctx.req.headers['user-agent'] ?? 'graphql',
  };
}

@Resolver('AuthPayload')
export class AuthResolver {
  constructor(private readonly auth: AuthService) {}

  @Mutation('authenticateLineLiff')
  async authenticateLineLiff(
    @Args('tenantId') tenantId: string,
    @Context() ctx: GraphQLContext,
    @Args('idToken') idToken?: string,
    @Args('accessToken') accessToken?: string,
    @Args('referralCode') referralCode?: string,
  ) {
    const parsed = AuthenticateLineLiffInputSchema.safeParse({
      idToken,
      accessToken,
      tenantId,
      referralCode,
    });
    if (!parsed.success) throw new BadRequestException('Invalid LINE authentication input');
    const token = parsed.data.idToken ?? parsed.data.accessToken;
    if (!token) throw new BadRequestException('Invalid LINE authentication input');
    const result = await this.auth.authenticateLineLiff(
      { idToken: token, tenantId: parsed.data.tenantId, referralCode: parsed.data.referralCode },
      reqMeta(ctx),
    );
    return toPayload(result, parsed.data.tenantId);
  }

  @Mutation('authenticateWebOAuth')
  async authenticateWebOAuth(
    @Args('provider') provider: string,
    @Args('code') code: string,
    @Args('state') state: string,
    @Args('redirectUri') redirectUri: string,
    @Args('tenantId') tenantId: string,
    @Context() ctx: GraphQLContext,
  ) {
    const result = await this.auth.authenticateWebOAuth(
      provider,
      code,
      state,
      redirectUri,
      tenantId,
      reqMeta(ctx),
    );
    return toPayload(result, tenantId);
  }

  @Mutation('refreshAccessToken')
  async refreshAccessToken(@Context() ctx: GraphQLContext) {
    const refreshToken = ctx.req.cookies?.['__Host-next-auth.refresh-token'];
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');
    const result = await this.auth.refreshAccessToken(refreshToken, reqMeta(ctx));
    return toPayload(result, ctx.tenantId);
  }

  @Mutation('logoutSession')
  async logoutSession(@Context() ctx: GraphQLContext): Promise<boolean> {
    const sessionId = ctx.user?.sessionId ?? ctx.req.user?.sessionId;
    if (!sessionId) throw new UnauthorizedException('Missing active session');
    return this.auth.logoutSession(sessionId, reqMeta(ctx));
  }
}
