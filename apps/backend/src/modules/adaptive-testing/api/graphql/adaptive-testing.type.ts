// SSOT Phase 093 Task 2 — Adaptive testing GraphQL types (code-first)
// Canonical: apps/backend/src/modules/adaptive-testing/api/graphql/adaptive-testing.type.ts
// - Zero new deps.
import { Field, Float, ID, Int, ObjectType, InputType } from '@nestjs/graphql';

@ObjectType('AdaptiveOption')
export class AdaptiveOptionGql {
  @Field()
  id!: string;

  @Field()
  text!: string;
}

@ObjectType('AdaptiveNextQuestion')
export class AdaptiveNextQuestionGql {
  @Field(() => ID)
  questionId!: string;

  @Field()
  questionText!: string;

  @Field(() => [AdaptiveOptionGql])
  options!: AdaptiveOptionGql[];

  @Field(() => Float)
  currentTheta!: number;

  @Field(() => Float)
  estimatedMasteryPercent!: number;

  @Field()
  isTestCompleted!: boolean;
}

@InputType('AdaptiveSubmitAnswerInput')
export class AdaptiveSubmitAnswerInputGql {
  @Field(() => ID)
  lessonId!: string;

  @Field(() => ID)
  questionId!: string;

  @Field()
  selectedOptionId!: string;

  @Field(() => Int)
  responseTimeMs!: number;
}
