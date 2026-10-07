// SSOT Phase 034 Task 3/§3.2 — LINE OA GraphQL presentation (code-first)
// Canonical: apps/backend/src/modules/line-oa/line-oa.resolver.ts
// (legacy src/backend/modules/line-oa/line-oa.resolver.ts)
// Runtime is code-first (autoSchemaFile); SDL supplement lives at
// apps/backend/src/api/graphql/schemas/line-oa.graphql/schema.graphql.
// - Zero new deps.
import { Resolver, Query, Mutation, Args, ObjectType, Field, ID } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { LineOAService } from './line-oa.service';
import { LineAuthService } from '../auth/line-auth.service';

@ObjectType('LineOAFriendshipPayload')
class LineOAFriendshipPayloadGql {
  @Field() isOAFriend!: boolean;
  @Field() lineOaBasicId!: string;
  @Field() lineOaQrCodeUrl!: string;
  @Field() updatedAt!: string;
}

@Resolver('LineOA')
export class LineOAResolver {
  constructor(
    private readonly lineOA: LineOAService,
    private readonly lineAuth: LineAuthService,
  ) {}

  @Query('getLineOAFriendshipStatus')
  async getLineOAFriendshipStatus(@Args('tenantId') tenantId: string, @Args('lineUserId') lineUserId: string) {
    if (!tenantId || !lineUserId) throw new BadRequestException('Missing OA identity');
    const [config, flag] = await Promise.all([
      this.lineOA.publicConfig(tenantId),
      this.lineAuth.getOAFriendship(lineUserId),
    ]);
    return {
      isOAFriend: flag.isOAFriend,
      lineOaBasicId: config.lineOaBasicId,
      lineOaQrCodeUrl: `https://qr-official.line.me/sid/M/${config.lineOaBasicId.replace('@', '')}.png`,
      updatedAt: new Date().toISOString(),
    };
  }

  @Mutation('syncLineOAFriendship')
  syncLineOAFriendship(@Args('tenantId') tenantId: string, @Args('lineUserId') lineUserId: string, @Args('isOAFriend') isOAFriend: boolean) {
    if (!tenantId || !lineUserId || typeof isOAFriend !== 'boolean') throw new BadRequestException('Missing OA identity');
    return this.lineAuth.syncOAFriendship({ lineUserId, isOAFriend });
  }
}
