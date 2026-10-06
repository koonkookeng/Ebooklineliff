// SSOT Phase 007 §3.2 — QR GraphQL intents (init query + confirm/reject mutations)
// Canonical: .../qr-sync/presentation/resolvers/qr-auth.resolver.ts
import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InitQrSessionUseCase } from '../../application/use-cases/init-qr-session.use-case';
import { AuthorizeQrSessionUseCase } from '../../application/use-cases/authorize-qr-session.use-case';
import type { GraphQLContext } from '../../../../../api/graphql/context/graphql-context.factory';

function bearer(ctx: GraphQLContext): string {
  const auth = ctx.req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ') && auth.length > 12) {
    return auth.slice('Bearer '.length);
  }
  throw new UnauthorizedException('INVALID_LINE_TOKEN');
}

@Resolver('QrSession')
export class QrAuthResolver {
  constructor(
    private readonly initQr: InitQrSessionUseCase,
    private readonly authorizeQr: AuthorizeQrSessionUseCase,
  ) {}

  @Query('initQrLoginSession')
  async initQrLoginSession(@Args('tenantId') tenantId: string | undefined, @Context() ctx: GraphQLContext) {
    const tenant = tenantId ?? ctx.tenantId;
    return this.initQr.init({ desktopIp: ctx.req.ip ?? null, tenantId: tenant });
  }

  @Mutation('confirmQrSessionAuth')
  async confirmQrSessionAuth(
    @Args('input') input: { qrToken: string; deviceFingerprint: string },
    @Context() ctx: GraphQLContext,
  ) {
    if (!input?.qrToken || !input?.deviceFingerprint) {
      throw new BadRequestException('Invalid QR confirm input');
    }
    return this.authorizeQr.authorize({
      qrToken: input.qrToken,
      userAccessToken: bearer(ctx),
      deviceFingerprint: input.deviceFingerprint,
      userAgent: ctx.req.headers['user-agent'] ?? 'liff-scan',
      ipAddress: ctx.req.ip ?? 'unknown',
    });
  }

  @Mutation('rejectQrSessionAuth')
  async rejectQrSessionAuth(@Args('qrToken') qrToken: string, @Context() ctx: GraphQLContext) {
    if (!qrToken) throw new BadRequestException('Missing QR token');
    return this.authorizeQr.reject({ qrToken, accessToken: bearer(ctx) });
  }
}
