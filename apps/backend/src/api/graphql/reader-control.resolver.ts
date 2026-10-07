// SSOT Phase 041 §3.2 — ReaderControlResolver (code-first intent layer)
// Canonical: apps/backend/src/api/graphql/reader-control.resolver.ts
// (legacy src/backend/api/graphql/reader-control.resolver.ts)
// Runtime is code-first (autoSchemaFile); SDL supplement lives at
// apps/backend/src/api/graphql/schemas/reader-control.graphql/schema.graphql.
// - Query.getEbookAnnotations + getReaderPreferences,
//   Mutation.toggleBookmark/saveHighlight/deleteHighlight/updateReaderPreferences
//   ride the same ReaderControlService as REST (no HTTP hop).
// - Identity from @Context() via shared resolveReaderIdentity (JWT tenant is
//   informational here; annotation keys are user-scoped).
// - Zero new deps.
import { Args, Context, Field, Float, ID, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { CreateBookmarkInputSchema, CreateHighlightInputSchema, ReaderPreferenceSchema } from '@repo/shared';
import { ReaderControlService } from '../../modules/reader/reader-control.service';
import { resolveReaderIdentity, type ReaderGqlContext } from '../../modules/reader/reader-identity';

@ObjectType('ReaderControlBookmarkPayload')
class BookmarkPayloadGql {
  @Field(() => ID) id!: string;
  @Field(() => Int) pageNumber!: number;
  @Field({ nullable: true }) chapterTitle?: string | null;
  @Field() createdAt!: string;
}

@ObjectType('ReaderControlHighlightPayload')
class HighlightPayloadGql {
  @Field(() => ID) id!: string;
  @Field(() => Int) pageNumber!: number;
  @Field() colorHex!: string;
  @Field() boundingRectsJson!: string;
  @Field() selectedText!: string;
  @Field({ nullable: true }) noteText?: string | null;
  @Field() createdAt!: string;
}

@ObjectType('ReaderControlAnnotationContainer')
class AnnotationContainerGql {
  @Field(() => [BookmarkPayloadGql]) bookmarks!: BookmarkPayloadGql[];
  @Field(() => [HighlightPayloadGql]) highlights!: HighlightPayloadGql[];
}

@ObjectType('ReaderControlPreferencePayload')
class PreferencePayloadGql {
  @Field() theme!: string;
  @Field(() => Int) fontSizePx!: number;
  @Field() fontFamily!: string;
  @Field(() => Float) lineSpacing!: number;
  @Field() autoHideControls!: boolean;
}

@ObjectType('ReaderControlBookmarkToggle')
class BookmarkToggleGql {
  @Field() isBookmarked!: boolean;
  @Field(() => BookmarkPayloadGql, { nullable: true }) bookmark?: BookmarkPayloadGql | null;
}

function coerceRects(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    try {
      const parsed: unknown = JSON.parse(input);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      throw new BadRequestException('Invalid bounding rects');
    }
  }
  throw new BadRequestException('Invalid bounding rects');
}

@Resolver('ReaderControl')
export class ReaderControlResolver {
  constructor(private readonly controls: ReaderControlService) {}

  @Query('getEbookAnnotations')
  @UseGuards(JwtAuthGuard)
  async getEbookAnnotations(@Args('productId') productId: string, @Context() gqlCtx?: ReaderGqlContext) {
    const { userId } = resolveReaderIdentity(gqlCtx);
    return this.controls.getAnnotations(userId, productId);
  }

  @Query('getReaderPreferences')
  @UseGuards(JwtAuthGuard)
  async getReaderPreferences(@Context() gqlCtx?: ReaderGqlContext) {
    const { userId } = resolveReaderIdentity(gqlCtx);
    return this.controls.getPreferences(userId);
  }

  @Mutation('toggleBookmark')
  @UseGuards(JwtAuthGuard)
  async toggleBookmark(
    @Args('productId') productId: string,
    @Args('pageNumber', { type: () => Int }) pageNumber: number,
    @Args('chapterTitle', { nullable: true }) chapterTitle: string | null,
    @Context() gqlCtx?: ReaderGqlContext,
  ) {
    const parsed = CreateBookmarkInputSchema.safeParse({
      productId,
      pageNumber,
      chapterTitle: chapterTitle ?? undefined,
    });
    if (!parsed.success) throw new BadRequestException('Invalid bookmark input');
    const { userId } = resolveReaderIdentity(gqlCtx);
    return this.controls.toggleBookmark(userId, parsed.data);
  }

  @Mutation('saveHighlight')
  @UseGuards(JwtAuthGuard)
  async saveHighlight(
    @Args('productId') productId: string,
    @Args('pageNumber', { type: () => Int }) pageNumber: number,
    @Args('colorHex') colorHex: string,
    @Args('boundingRectsJson') boundingRectsJson: string,
    @Args('selectedText') selectedText: string,
    @Args('noteText', { nullable: true }) noteText: string | null,
    @Context() gqlCtx?: ReaderGqlContext,
  ) {
    const parsed = CreateHighlightInputSchema.safeParse({
      productId,
      pageNumber,
      colorHex,
      boundingRects: coerceRects(boundingRectsJson),
      selectedText,
      noteText: noteText ?? undefined,
    });
    if (!parsed.success) throw new BadRequestException('Invalid highlight input');
    const { userId } = resolveReaderIdentity(gqlCtx);
    return this.controls.saveHighlight(userId, parsed.data);
  }

  @Mutation('deleteHighlight')
  @UseGuards(JwtAuthGuard)
  async deleteHighlight(@Args('highlightId') highlightId: string, @Context() gqlCtx?: ReaderGqlContext) {
    const { userId } = resolveReaderIdentity(gqlCtx);
    return this.controls.deleteHighlight(userId, highlightId);
  }

  @Mutation('updateReaderPreferences')
  @UseGuards(JwtAuthGuard)
  async updateReaderPreferences(
    @Args('theme') theme: string,
    @Args('fontSizePx', { type: () => Int }) fontSizePx: number,
    @Args('fontFamily') fontFamily: string,
    @Args('lineSpacing', { type: () => Float }) lineSpacing: number,
    @Args('autoHideControls') autoHideControls: boolean,
    @Context() gqlCtx?: ReaderGqlContext,
  ) {
    const parsed = ReaderPreferenceSchema.safeParse({ theme, fontSizePx, fontFamily, lineSpacing, autoHideControls });
    if (!parsed.success) throw new BadRequestException('Invalid preference input');
    const { userId } = resolveReaderIdentity(gqlCtx);
    return this.controls.updatePreferences(userId, parsed.data);
  }
}
