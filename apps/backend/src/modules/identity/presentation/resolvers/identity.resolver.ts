// SSOT Phase 003 §5.1 — identity GraphQL presentation (profile queries)
// Phase 003 REVIEW: address-book mutations (spec §3.2) delegate to the
// existing IdentityService lane (no new service code).
import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { IdentityService } from '../../application/identity.service';
import type { GraphQLContext } from '../../../../api/graphql/context/graphql-context.factory';
import type { UserAddressInput } from '@repo/shared';

type Ctx = GraphQLContext & { user: { id: string } };

@Resolver('UserProfile')
export class IdentityResolver {
  constructor(private readonly identity: IdentityService) {}

  @Query('me')
  me(@Context() ctx: Ctx) {
    return this.identity.getProfile(ctx.user.id);
  }

  @Mutation('updateUserProfile')
  updateUserProfile(
    @Args('displayName') displayName: string,
    @Args('avatarUrl', { nullable: true }) avatarUrl: string | null,
    @Args('phone', { nullable: true }) phone: string | null,
    @Context() ctx: Ctx,
  ) {
    return this.identity.updateProfile(ctx.user.id, {
      displayName,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(phone ? { phone } : {}),
    });
  }

  @Mutation('upsertUserAddress')
  upsertUserAddress(@Args('input') input: UserAddressInput, @Context() ctx: Ctx) {
    return this.identity.upsertAddress(ctx.user.id, input);
  }

  @Mutation('deleteUserAddress')
  async deleteUserAddress(@Args('addressId') addressId: string, @Context() ctx: Ctx) {
    const result = await this.identity.deleteAddress(ctx.user.id, addressId);
    return result.count > 0;
  }
}
