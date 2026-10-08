// SSOT Phase 074 §3/Gate 1 — Builder GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/product-builder/resolvers/product-builder.resolver.ts
// - saveBuilderDraft(input) + publishBuilderProduct(input) behind the
//   authenticated gateway (sellerId from context user).
// - Zero new deps.
import { Args, Field, ID, InputType, Int, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { ProductBuilderService } from '../services/product-builder.service';

@ObjectType('BuilderDraftResult')
class BuilderDraftResultGql {
  @Field(() => ID) draftId!: string;
}

@ObjectType('PublishedProductResult')
class PublishedProductResultGql {
  @Field(() => ID) productId!: string;
  @Field() slug!: string;
}

@InputType('SaveBuilderDraftInput')
class SaveBuilderDraftInputGql {
  @Field(() => ID, { nullable: true }) draftId?: string | null;
  @Field(() => Int) stepIndex!: number;
  @Field() productType!: string;
  @Field({ nullable: true }) title?: string | null;
  @Field({ nullable: true }) payloadJson?: string | null;
}

@Resolver('ProductBuilder')
export class ProductBuilderResolver {
  constructor(private readonly builder: ProductBuilderService) {}

  @Mutation('saveBuilderDraft')
  saveBuilderDraft(@Args('input') input: SaveBuilderDraftInputGql, @Context() ctx: Record<string, unknown>) {
    const sellerId = ((ctx['req'] as Record<string, unknown> | undefined)?.['user'] as { id?: string } | undefined)?.id;
    if (!sellerId) throw new BadRequestException('Missing seller context');
    let payload: Record<string, unknown> = { productType: input.productType };
    if (input.title) payload['title'] = input.title;
    if (input.draftId) payload['draftId'] = input.draftId;
    if (input.payloadJson) {
      try {
        payload = { ...payload, ...(JSON.parse(input.payloadJson) as Record<string, unknown>) };
      } catch {
        throw new BadRequestException('Invalid payloadJson');
      }
    }
    return this.builder.saveDraft(sellerId, input.stepIndex, payload);
  }

  @Query('loadBuilderDraft')
  loadBuilderDraft(@Args('draftId') draftId: string, @Context() ctx: Record<string, unknown>) {
    const sellerId = ((ctx['req'] as Record<string, unknown> | undefined)?.['user'] as { id?: string } | undefined)?.id;
    if (!sellerId || !draftId) throw new BadRequestException('Missing draft context');
    return this.builder.loadDraft(sellerId, draftId).then((r) =>
      r ? { stepIndex: r.stepIndex, payloadJson: JSON.stringify(r.payload) } : null,
    );
  }

  @Mutation('publishBuilderProduct')
  publishBuilderProduct(@Args('payloadJson') payloadJson: string, @Context() ctx: Record<string, unknown>) {
    const gqlReq = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
    const sellerId = (gqlReq['user'] as { id?: string } | undefined)?.id;
    const headers = (gqlReq['headers'] as Record<string, string> | undefined) ?? {};
    const tenantId = ((gqlReq['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '').trim();
    if (!sellerId || !tenantId) throw new BadRequestException('Missing seller/tenant context');
    let body: unknown;
    try {
      body = JSON.parse(payloadJson) as unknown;
    } catch {
      throw new BadRequestException('Invalid payloadJson');
    }
    return this.builder.publishProduct(sellerId, tenantId, body);
  }
}
