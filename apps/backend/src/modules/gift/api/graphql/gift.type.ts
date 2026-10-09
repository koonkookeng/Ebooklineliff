// SSOT Phase 089 §3.1 — Gift GraphQL object vocabulary (code-first companion)
// Canonical: apps/backend/src/modules/gift/api/graphql/gift.type.ts
// - Companion to the code-first resolver (single source, no SDL drift).
// - Zero new deps.
import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('GiftDetail')
export class GiftDetailGql {
  @Field(() => ID) giftId!: string;
  @Field() claimCode!: string;
  @Field() status!: string;
  @Field() productTitle!: string;
  @Field() productCoverUrl!: string;
  @Field() productType!: string;
  @Field() senderName!: string;
  @Field() greetingTheme!: string;
  @Field() greetingMessage!: string;
  @Field() expiresAt!: string;
  @Field({ nullable: true }) claimedAt!: string | null;
  @Field({ nullable: true }) recipientName!: string | null;
}

@ObjectType('CreateGiftPayload')
export class CreateGiftPayloadGql {
  @Field(() => ID) giftId!: string;
  @Field() claimCode!: string;
  @Field() flexMessageJson!: string;
  @Field() claimUrl!: string;
  @Field() expiresAt!: string;
}

@ObjectType('ClaimGiftResult')
export class ClaimGiftResultGql {
  @Field() success!: boolean;
  @Field() message!: string;
  @Field(() => ID, { nullable: true }) productId!: string | null;
}

@ObjectType('GiftKFactor')
export class GiftKFactorGql {
  @Field(() => Int) sent!: number;
  @Field(() => Int) claimed!: number;
  @Field(() => Float) kFactor!: number;
}
