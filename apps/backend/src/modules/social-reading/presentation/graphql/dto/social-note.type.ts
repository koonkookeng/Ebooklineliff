// SSOT Phase 095 §5.1 — Social reading GraphQL types (code-first)
// Canonical: apps/backend/src/modules/social-reading/presentation/graphql/dto/social-note.type.ts
// - Zero new deps.
import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('MarginNote')
export class MarginNoteGql {
  @Field(() => ID)
  id!: string;

  @Field()
  userDisplayName!: string;

  @Field(() => String, { nullable: true })
  userAvatarUrl!: string | null;

  @Field()
  isAuthorNote!: boolean;

  @Field(() => Int)
  pageNumber!: number;

  @Field(() => Float)
  positionX!: number;

  @Field(() => Float)
  positionY!: number;

  @Field()
  content!: string;

  @Field(() => Int)
  likesCount!: number;
}

@ObjectType('CreateNotePayload')
export class CreateNotePayloadGql {
  @Field(() => ID)
  noteId!: string;

  @Field()
  flexMessageJson!: string;
}

@ObjectType('LikeNotePayload')
export class LikeNotePayloadGql {
  @Field()
  liked!: boolean;

  @Field(() => Int)
  likesCount!: number;
}
