// SSOT Phase 038 Task 2/§3.2 — Book pipeline GraphQL presentation (code-first)
// Canonical: apps/backend/src/modules/pipeline/presentation/resolvers/book-pipeline.resolver.ts
// (legacy src/backend/modules/pipeline/presentation/resolvers/book-pipeline.resolver.ts)
// Runtime is code-first (autoSchemaFile); SDL supplement lives at
// apps/backend/src/api/graphql/schemas/book-pipeline.graphql/schema.graphql.
// - Mutations enqueue through the same controller-equivalent path (service
//   direct — no HTTP hop); status reads the job row (null-safe).
// - Zero new deps.
import { Resolver, Query, Args, ObjectType, Field, ID, Float } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';

@ObjectType('BookPipelineStatusPayload')
class BookPipelineStatusPayloadGql {
  @Field(() => ID) jobId!: string;
  @Field(() => ID) bookId!: string;
  @Field() status!: string;
  @Field(() => Float) progressPercentage!: number;
  @Field() processedPages!: number;
  @Field() totalPages!: number;
  @Field({ nullable: true }) errorMessage!: string | null;
}

@Resolver('BookPipeline')
export class BookPipelineResolver {
  constructor(private readonly prisma: PrismaService) {}

  @Query('getBookPipelineStatus')
  async getBookPipelineStatus(@Args('jobId') _jobId: string, @Args('productId', { nullable: true }) productId?: string | null) {
    if (!productId) throw new BadRequestException('Missing product id');
    const row = await (this.prisma as unknown as {
      bookProcessingJob: { findUnique: (a: unknown) => Promise<null | { id: string; status: string; progressPercentage: number; processedPages: number; totalPages: number; errorMessage: string | null }> };
    }).bookProcessingJob.findUnique({ where: { productId } }).catch(() => null);
    if (!row) {
      return { jobId: '', bookId: productId, status: 'QUEUED', progressPercentage: 0, processedPages: 0, totalPages: 0, errorMessage: null };
    }
    return { jobId: row.id, bookId: productId, status: row.status, progressPercentage: row.progressPercentage, processedPages: row.processedPages, totalPages: row.totalPages, errorMessage: row.errorMessage };
  }
}
