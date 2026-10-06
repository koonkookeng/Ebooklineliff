// SSOT Phase 023 §3.2/§5 — Header GraphQL presentation (code-first, Zod-gated)
// Canonical: apps/backend/src/modules/header/header.resolver.ts
// (legacy src/backend/modules/header/header.resolver.ts)
import { Resolver, Query, Mutation, Args, ObjectType, Field, ID, Float, InputType } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { HeaderService } from './header.service';

@ObjectType('HeaderActionIcon')
class HeaderActionIconGql {
  @Field(() => ID) id!: string;
  @Field() iconName!: string;
  @Field() actionIntent!: string;
}

@ObjectType('DynamicHeaderContext')
class DynamicHeaderContextGql {
  @Field(() => ID) tenantId!: string;
  @Field() displayMode!: string;
  @Field() mainTitle!: string;
  @Field({ nullable: true }) subtitle!: string | null;
  @Field(() => Float, { nullable: true }) progressPercentage!: number | null;
  @Field() brandColor!: string;
  @Field({ nullable: true }) logoUrl!: string | null;
  @Field() showBackButton!: boolean;
  @Field({ nullable: true }) backToUrl!: string | null;
  @Field(() => [HeaderActionIconGql]) actionIcons!: HeaderActionIconGql[];
}

@InputType('DynamicHeaderInput')
class DynamicHeaderInputGql {
  @Field(() => ID) productId!: string;
  @Field({ nullable: true }) chapterOrLessonId!: string | null;
  @Field({ nullable: true }) customTitle!: string | null;
}

@Resolver('Header')
export class HeaderResolver {
  constructor(private readonly headers: HeaderService) {}

  @Query('getHeaderContext')
  getHeaderContext(
    @Args('productId') productId: string,
    @Args('chapterOrLessonId', { nullable: true }) chapterOrLessonId: string | null | undefined,
  ) {
    if (!productId) throw new BadRequestException('Missing product id');
    return this.headers.getHeaderContext(productId, chapterOrLessonId ?? undefined);
  }

  @Mutation('updateHeaderContext')
  updateHeaderContext(@Args('input') input: DynamicHeaderInputGql) {
    if (!input?.productId) throw new BadRequestException('Missing product id');
    return this.headers.updateHeaderContext({
      productId: input.productId,
      ...(input.chapterOrLessonId ? { chapterOrLessonId: input.chapterOrLessonId } : {}),
      ...(input.customTitle ? { customTitle: input.customTitle } : {}),
    });
  }
}
