// SSOT Phase 044 — StreamJobResolver (transcode status intent layer)
// Canonical: apps/backend/src/modules/stream/stream.resolver.ts
// (legacy src/backend/modules/stream/stream.resolver.ts)
// - Query.getTranscodeJobStatus(jobId): ledger status + variants for the
//   studio stepper (same reader the REST gateway uses, no HTTP hop).
// - RISK_CALL: spec §3 carries no GQL section; this minimal status query
//   follows the repo code-first pattern (Phase 038/040 precedent) so LIFF
//   clients share one contract across transports.
// - Zero new deps.
import { Args, Field, Float, ID, Int, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { Context } from '@nestjs/graphql';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { resolveReaderIdentity, type ReaderGqlContext } from '../reader/reader-identity';
import { TranscodeJobReaderService } from './services/transcode-job-reader.service';

@ObjectType('TranscodeVariantStatus')
class TranscodeVariantStatusGql {
  @Field() quality!: string;
  @Field(() => Int) totalChunks!: number;
  @Field(() => Int) avgChunkSizeBytes!: number;
}

@ObjectType('TranscodeJobStatusPayload')
class TranscodeJobStatusPayloadGql {
  @Field(() => ID) jobId!: string;
  @Field(() => ID) lessonId!: string;
  @Field() status!: string;
  @Field(() => Float) progressPercentage!: number;
  @Field({ nullable: true }) masterPlaylistUrl?: string | null;
  @Field({ nullable: true }) errorMessage?: string | null;
  @Field(() => [TranscodeVariantStatusGql]) variants!: TranscodeVariantStatusGql[];
}

@Resolver('StreamJob')
export class StreamJobResolver {
  constructor(private readonly jobs: TranscodeJobReaderService) {}

  @Query('getTranscodeJobStatus')
  @UseGuards(JwtAuthGuard)
  async getTranscodeJobStatus(@Args('jobId') jobId: string, @Context() gqlCtx?: ReaderGqlContext) {
    resolveReaderIdentity(gqlCtx);
    if (!jobId) throw new BadRequestException('Missing job id');
    const row = await this.jobs?.findJobWithVariants(jobId).catch(() => null);
    if (!row) throw new BadRequestException('Transcode job not found');
    return row;
  }
}
