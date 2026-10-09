// SSOT Phase 095 §5.1 — Social reading GraphQL input (code-first)
// Canonical: apps/backend/src/modules/social-reading/presentation/graphql/dto/create-note.input.ts
// - Zero new deps.
import { Field, Float, ID, InputType, Int } from '@nestjs/graphql';

@InputType('CreateMarginNoteInput')
export class CreateMarginNoteInput {
  @Field(() => ID)
  ebookId!: string;

  @Field(() => Int)
  pageNumber!: number;

  @Field(() => Float)
  positionX!: number;

  @Field(() => Float)
  positionY!: number;

  @Field(() => String, { nullable: true })
  selectedText?: string;

  @Field()
  content!: string;

  @Field()
  visibility!: string;

  @Field()
  noteType!: string;

  @Field(() => ID, { nullable: true })
  studyGroupId?: string;
}
