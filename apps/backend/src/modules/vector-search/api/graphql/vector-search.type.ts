// SSOT Phase 091 Task 5 — Vector search GraphQL object types (code-first)
// Canonical: apps/backend/src/modules/vector-search/api/graphql/vector-search.type.ts
// - RISK_CALL: placed under api/graphql (089/090 canonical layout); legacy
//   resolvers/ + controllers/ dirs become thin aliases.
// - Zero new deps.
import { Field, Float, ID, Int, ObjectType, InputType } from '@nestjs/graphql';

@ObjectType('VectorSearchResultItem')
export class VectorSearchResultItemGql {
  @Field()
  sourceType!: string;

  @Field(() => ID)
  sourceId!: string;

  @Field(() => ID)
  productId!: string;

  @Field()
  productTitle!: string;

  @Field(() => Int)
  chunkIndex!: number;

  @Field()
  contentText!: string;

  @Field(() => Float)
  similarityScore!: number;

  @Field(() => Int, { nullable: true })
  pageNumber?: number;

  @Field(() => Int, { nullable: true })
  videoTimestampSec?: number;
}

@ObjectType('SemanticSearchPayload')
export class SemanticSearchPayloadGql {
  @Field(() => [VectorSearchResultItemGql])
  items!: VectorSearchResultItemGql[];

  @Field(() => Int)
  tookMs!: number;
}

@ObjectType('AiAskPayload')
export class AiAskPayloadGql {
  @Field()
  answer!: string;

  @Field(() => [Int])
  referencedPages!: number[];
}

@InputType('SemanticSearchInput')
export class SemanticSearchInputGql {
  @Field()
  queryText!: string;

  @Field(() => [String], { nullable: true })
  sourceTypes?: string[];

  @Field(() => ID, { nullable: true })
  productIdFilter?: string;

  @Field(() => Int, { nullable: true })
  limit?: number;

  @Field(() => Float, { nullable: true })
  similarityThreshold?: number;
}

@InputType('AiAskContextQueryInput')
export class AiAskContextQueryInputGql {
  @Field(() => ID)
  productId!: string;

  @Field()
  userQuestion!: string;

  @Field(() => Int, { nullable: true })
  currentPage?: number;
}
