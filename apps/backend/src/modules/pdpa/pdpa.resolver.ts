// SSOT Phase 129 §3.2 — PDPA GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/pdpa/pdpa.resolver.ts
// (legacy src/backend/modules/pdpa/pdpa.resolver.ts)
// - Query.getPdpaConsentStatus / Query.exportMyPersonalData /
//   Mutation.updatePdpaConsent / Mutation.submitDataSubjectRequest.
//   Owner-scoped via GraphQL context identity (120 actorOf precedent).
// - Zero new deps.
import { Args, Context, Field, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { PDPAConsentPayloadSchema, DataSubjectRequestSchema } from '@repo/shared';
import { ConsentManagerService } from './services/consent-manager.service';
import { DsrEngineService } from './services/dsr-engine.service';

@ObjectType('PdpaConsentStatusPayload')
class PdpaConsentStatusPayloadGql {
  @Field() isNecessaryAccepted!: boolean;
  @Field() isMarketingAccepted!: boolean;
  @Field() isAnalyticsAccepted!: boolean;
  @Field() consentVersion!: string;
  @Field() updatedAt!: string;
}

@ObjectType('DataExportPayload')
class DataExportPayloadGql {
  @Field() downloadUrl!: string;
  @Field() expiresAt!: string;
}

@ObjectType('DSRResponsePayload')
class DSRResponsePayloadGql {
  @Field() requestId!: string;
  @Field() status!: string;
  @Field() estimatedCompletion!: string;
}

type LooseCtx = Record<string, unknown>;

function actorOf(ctx: LooseCtx): { id: string; ip: string; ua: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  const fwd = headers['x-forwarded-for'] ?? '';
  return {
    id: user.id,
    ip: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
    ua: headers['user-agent'] ?? 'unknown',
  };
}

@Resolver('Pdpa')
export class PdpaResolver {
  constructor(
    private readonly consents: ConsentManagerService,
    private readonly dsr: DsrEngineService,
  ) {}

  @Query(() => PdpaConsentStatusPayloadGql)
  async getPdpaConsentStatus(@Context() ctx: LooseCtx): Promise<PdpaConsentStatusPayloadGql> {
    const actor = actorOf(ctx);
    return this.consents.statusPayload(actor.id);
  }

  @Query(() => DataExportPayloadGql)
  async exportMyPersonalData(@Context() ctx: LooseCtx): Promise<DataExportPayloadGql> {
    const actor = actorOf(ctx);
    const bundle = await this.dsr.exportPackage(actor.id);
    const encoded = Buffer.from(JSON.stringify(bundle), 'utf8').toString('base64url');
    const expiresAt = new Date(Date.now() + 86400 * 1000).toISOString();
    // RISK_CALL: inline ticket (no R2 presign dup — 019 receipt lane owns
    // presigned downloads). Client exchanges this ticket at the REST lane.
    return { downloadUrl: `pdpa-ticket:${encoded.slice(0, 2048)}`, expiresAt };
  }

  @Mutation(() => Boolean)
  async updatePdpaConsent(
    @Context() ctx: LooseCtx,
    @Args('consentVersion') consentVersion: string,
    @Args('necessary') necessary: boolean,
    @Args('marketing') marketing: boolean,
    @Args('analytics') analytics: boolean,
  ): Promise<boolean> {
    const actor = actorOf(ctx);
    const acceptedPurposes: string[] = [];
    if (necessary) acceptedPurposes.push('NECESSARY_TERMS');
    if (marketing) acceptedPurposes.push('MARKETING_PROMOTION');
    if (analytics) acceptedPurposes.push('ANALYTICS_BEHAVIOR');
    const parsed = PDPAConsentPayloadSchema.safeParse({
      consentVersion,
      acceptedPurposes,
      ipAddress: actor.ip,
      userAgent: actor.ua,
      acceptedAt: new Date().toISOString(),
    });
    if (!parsed.success) throw new BadRequestException('Invalid consent payload');
    await this.consents.recordConsent(actor.id, parsed.data);
    return true;
  }

  @Mutation(() => DSRResponsePayloadGql)
  async submitDataSubjectRequest(
    @Context() ctx: LooseCtx,
    @Args('requestType') requestType: string,
    @Args('reason', { nullable: true }) reason?: string,
  ): Promise<DSRResponsePayloadGql> {
    const actor = actorOf(ctx);
    const parsed = DataSubjectRequestSchema.safeParse({
      requestType,
      ...(reason ? { reason } : {}),
      identityVerificationProof: `jwt:${actor.id}`,
    });
    if (!parsed.success) throw new BadRequestException('Invalid DSR payload');
    const row = await this.dsr.submit(actor.id, {
      requestType: parsed.data.requestType,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    });
    return {
      requestId: row.id,
      status: row.status,
      estimatedCompletion: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
    };
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const PdpaResolverResolver = PdpaResolver;
