// SSOT Phase 085 §3.2/Gate 1 — KYC GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/kyc/resolvers/kyc.resolver.ts
// (legacy class name KycResolverResolver renamed — no importers.)
// - Mutation.submitKyc / Query.getKycStatus (self) / Mutation.decideKyc (admin).
// - Zero new deps.
import { Args, Field, Float, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { KycVerificationService } from '../services/kyc-verification.service';
import { R2PrivateVaultClient } from '../infra/r2-private-vault.client';

@ObjectType('KycSubmitPayload')
class KycSubmitPayloadGql {
  @Field() success!: boolean;
  @Field() kycId!: string;
  @Field(() => Float) nameMatchScore!: number;
  @Field() tier!: string;
}

@ObjectType('KycStatusPayload')
class KycStatusPayloadGql {
  @Field() kycStatus!: string;
  @Field({ nullable: true }) payoutStatus!: string | null;
  @Field({ nullable: true }) rejectionReason!: string | null;
}

@ObjectType('KycDecisionPayload')
class KycDecisionPayloadGql {
  @Field() kycId!: string;
  @Field() status!: string;
}

@ObjectType('KycUploadTicket')
class KycUploadTicketGql {
  @Field() objectKey!: string;
  @Field() uploadUrl!: string;
  @Field(() => Float) expiresInSec!: number;
}

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string; role?: string; ip: string; ua: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  const fwd = headers['x-forwarded-for'] ?? '';
  return {
    userId: user.id,
    ...(user.role ? { role: user.role } : {}),
    ip: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
    ua: headers['user-agent'] ?? 'unknown',
  };
}

@Resolver('Kyc')
export class KycResolver {
  constructor(
    private readonly kyc: KycVerificationService,
    private readonly vault: R2PrivateVaultClient,
  ) {}

  @Mutation('submitKyc')
  submitKyc(@Args('input') input: Record<string, unknown>, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    return this.kyc.submitCreatorKyc(c.userId, input, { ipAddress: c.ip, userAgent: c.ua });
  }

  @Query('getKycStatus')
  getKycStatus(@Context() ctx: LooseCtx) {
    return this.kyc.statusOf(ctxOf(ctx).userId);
  }

  @Mutation('decideKyc')
  decideKyc(
    @Args('kycId') kycId: string,
    @Args('status') status: string,
    @Args('rejectionReason', { nullable: true }) rejectionReason: string | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const c = ctxOf(ctx);
    return this.kyc.decideKyc(c.userId, c.role, { kycId, status, rejectionReason }, { ipAddress: c.ip, userAgent: c.ua });
  }

  @Mutation('kycUploadTicket')
  kycUploadTicket(@Args('kind') kind: string, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    if (kind !== 'id-card' && kind !== 'selfie' && kind !== 'bookbank') {
      throw new BadRequestException('Invalid document kind');
    }
    return this.vault.uploadUrl(c.userId, kind);
  }
}
