// SSOT Phase 090 Task 2 — Group-buying GraphQL object types (code-first)
// Canonical: apps/backend/src/modules/group-buying/api/graphql/group-buying.type.ts
// - Zero new deps.
import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('GroupMember')
export class GroupMemberGql {
  @Field(() => ID)
  userId!: string;

  @Field()
  displayName!: string;

  @Field(() => String, { nullable: true })
  avatarUrl!: string | null;

  @Field()
  joinedAt!: string;

  @Field()
  isCreator!: boolean;
}

@ObjectType('GroupRoomDetails')
export class GroupRoomDetailsGql {
  @Field(() => ID)
  roomId!: string;

  @Field(() => ID)
  productId!: string;

  @Field()
  productTitle!: string;

  @Field()
  coverImageUrl!: string;

  @Field()
  creatorDisplayName!: string;

  @Field(() => String, { nullable: true })
  creatorAvatarUrl!: string | null;

  @Field()
  groupType!: string;

  @Field(() => Float)
  originalPrice!: number;

  @Field(() => Float)
  discountedPrice!: number;

  @Field(() => Int)
  requiredMembers!: number;

  @Field(() => Int)
  currentMembersCount!: number;

  @Field()
  status!: string;

  @Field()
  expiresAt!: string;

  @Field(() => [GroupMemberGql])
  members!: GroupMemberGql[];
}

@ObjectType('CreateGroupRoomPayload')
export class CreateGroupRoomPayloadGql {
  @Field(() => ID)
  roomId!: string;

  @Field()
  roomCode!: string;

  @Field()
  flexMessageJson!: string;

  @Field()
  inviteUrl!: string;

  @Field()
  expiresAt!: string;

  @Field(() => Float)
  discountedPrice!: number;
}

@ObjectType('JoinGroupRoomResult')
export class JoinGroupRoomResultGql {
  @Field()
  success!: boolean;

  @Field()
  message!: string;

  @Field()
  isCompleted!: boolean;

  @Field(() => ID, { nullable: true })
  productId!: string | null;
}

@ObjectType('GroupKFactor')
export class GroupKFactorGql {
  @Field(() => Int)
  invitesSent!: number;

  @Field(() => Float)
  conversionRate!: number;

  @Field(() => Float)
  kFactor!: number;
}
