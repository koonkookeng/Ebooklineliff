// SSOT Phase 003 §5.1 — identity GraphQL presentation (profile queries)
import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { IdentityService } from '../../application/identity.service';
import type { GraphQLContext } from '../../../../api/graphql/context/graphql-context.factory';

@Resolver('UserProfile')
export class IdentityResolver {
  constructor(private readonly identity: IdentityService) {}

  @Query('me')
  me(@Context() ctx: GraphQLContext & { user: { id: string } }) {
    return this.identity.getProfile(ctx.user.id);
  }

  @Mutation('updateUserProfile')
  updateUserProfile(
    @Args('displayName') displayName: string,
    @Context() ctx: GraphQLContext & { user: { id: string } },
  ) {
    return this.identity.updateProfile(ctx.user.id, { displayName });
  }
}
