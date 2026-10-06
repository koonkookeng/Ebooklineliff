// SSOT Phase 013 §3.2 — PromptPay GraphQL presentation (dynamic QR + status)
// Canonical: apps/backend/src/modules/payment/promptpay.resolver.ts
// Code-first (autoSchemaFile); SDL supplement lives in
// apps/backend/src/api/graphql/schemas/promptpay.graphql/schema.graphql.
import { Resolver, Query, Mutation, Args, Context, ObjectType, Field, ID, Int, Float, InputType } from '@nestjs/graphql';
import { BadRequestException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { CreatePromptPayQRInputSchema } from '@repo/shared';
import { PromptPayQrService } from './services/promptpay-qr.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import type { GraphQLContext } from '../../api/graphql/context/graphql-context.factory';

@InputType('CreatePromptPayQRInput')
class CreatePromptPayQRInputGql {
  @Field(() => ID) orderId!: string;
  @Field(() => Int, { nullable: true }) expireMinutes?: number;
  @Field({ nullable: true }) useFractionalCent?: boolean;
}

@ObjectType('PromptPayQRPayload')
class PromptPayQRPayloadGql {
  @Field() qrCodePayload!: string;
  @Field({ nullable: true }) qrCodeBase64?: string;
  @Field() orderNumber!: string;
  @Field() reference1!: string;
  @Field({ nullable: true }) reference2?: string;
  @Field(() => Float) baseAmount!: number;
  @Field(() => Float) fractionalCent!: number;
  @Field(() => Float) totalAmount!: number;
  @Field() expiresAt!: string;
  @Field(() => Int) timeRemainingSec!: number;
}

@ObjectType('PromptPayStatusPayload')
class PromptPayStatusPayloadGql {
  @Field(() => ID) orderId!: string;
  @Field() status!: string;
  @Field() isExpired!: boolean;
}

function actor(ctx: GraphQLContext): { userId: string } {
  const userId = ctx.req.user?.id;
  if (!userId) throw new UnauthorizedException('Unauthorized');
  return { userId };
}

@Resolver('PromptPayQR')
export class PromptPayResolver {
  constructor(private readonly qr: PromptPayQrService) {}

  @Mutation('generateDynamicPromptPayQR')
  @UseGuards(JwtAuthGuard)
  generateDynamicPromptPayQR(@Args('input') input: CreatePromptPayQRInputGql, @Context() ctx: GraphQLContext) {
    const parsed = CreatePromptPayQRInputSchema.safeParse({
      orderId: input.orderId,
      expireMinutes: input.expireMinutes ?? 15,
      useFractionalCent: input.useFractionalCent ?? true,
    });
    if (!parsed.success) throw new BadRequestException('Invalid QR request payload');
    return this.qr.generateDynamicQR(actor(ctx).userId, parsed.data);
  }

  @Query('getPromptPayQRStatus')
  @UseGuards(JwtAuthGuard)
  getPromptPayQRStatus(@Args('orderId') orderId: string, @Context() ctx: GraphQLContext) {
    return this.qr.getStatus(actor(ctx).userId, orderId);
  }
}
