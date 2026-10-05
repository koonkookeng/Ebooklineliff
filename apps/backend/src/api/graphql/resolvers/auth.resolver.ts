// SSOT Phase 004 Task 004.3 — LINE LIFF auth resolver (SSO handshake; token mint = Phase 005)
import { Resolver, Mutation, Args, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { AuthenticateLineLiffInputSchema } from '@repo/shared';
import { IdentityService } from '../../../modules/identity/application/identity.service';
import type { GraphQLContext } from '../context/graphql-context.factory';

@Resolver('AuthPayload')
export class AuthResolver {
  constructor(private readonly identity: IdentityService) {}

  @Mutation('authenticateLineLiff')
  async authenticateLineLiff(
    @Args('accessToken') accessToken: string,
    @Args('tenantId') tenantId: string,
    @Context() ctx: GraphQLContext,
  ) {
    const parsed = AuthenticateLineLiffInputSchema.safeParse({ accessToken, tenantId });
    if (!parsed.success) {
      throw new BadRequestException('Invalid LINE authentication input');
    }
    void ctx;
    // NOTE: LINE OAuth verify + JWT mint land in Phase 005; here we validate shape only.
    return { token: '', userId: '' };
  }
}
