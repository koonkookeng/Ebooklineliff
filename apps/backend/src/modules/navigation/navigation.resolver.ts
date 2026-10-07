// SSOT Phase 027 §3.2 — Navigation GraphQL presentation (code-first, Zod-gated)
// Canonical: apps/backend/src/modules/navigation/navigation.resolver.ts
// (legacy src/backend/modules/navigation/navigation.resolver.ts)
// Runtime is code-first (autoSchemaFile); SDL supplement lives at
// apps/backend/src/api/graphql/schemas/navigation.graphql/schema.graphql
// (SSOT sync gate: navigation.schema.ts <-> Prisma UserNavigationSession <-> here).
import { Resolver, Query, Mutation, Args, ObjectType, Field, ID, Int, InputType } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { NavigationService } from './navigation.service';

@ObjectType('NavigationStackItem')
class NavigationStackItemGql {
  @Field(() => ID) id!: string;
  @Field() pathname!: string;
  @Field() timestamp!: number;
  @Field() isDirty!: boolean;
}

@ObjectType('NavigationStatePayload')
class NavigationStatePayloadGql {
  @Field() tenantId!: string;
  @Field() currentRoute!: string;
  @Field() canGoBack!: boolean;
  @Field(() => Int) stackDepth!: number;
  @Field() isDirtyState!: boolean;
  @Field(() => [NavigationStackItemGql]) historyStack!: NavigationStackItemGql[];
}

@InputType('SyncNavigationSessionInput')
class SyncNavigationSessionInputGql {
  @Field(() => ID) userId!: string;
  @Field() lineUserId!: string;
  @Field() currentRoute!: string;
  @Field() stateSnapshotJson!: string;
}

@Resolver('Navigation')
export class NavigationResolver {
  constructor(private readonly navigation: NavigationService) {}

  @Query('getNavigationSession')
  getNavigationSession(@Args('userId') userId: string) {
    if (!userId) throw new BadRequestException('Missing user id');
    return this.navigation.getSession(userId);
  }

  @Mutation('syncNavigationSession')
  syncNavigationSession(@Args('input') input: SyncNavigationSessionInputGql) {
    if (!input?.userId) throw new BadRequestException('Missing user id');
    return this.navigation.saveSession({
      userId: input.userId,
      lineUserId: input.lineUserId,
      lastPathname: input.currentRoute,
      stateSnapshotJson: input.stateSnapshotJson,
    });
  }

  @Mutation('clearNavigationSession')
  clearNavigationSession(@Args('userId') userId: string) {
    if (!userId) throw new BadRequestException('Missing user id');
    return this.navigation.clearSession(userId);
  }
}
