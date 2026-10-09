// SSOT Phase 094 Task 2 — Co-Pilot GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/ai-copilot/resolvers/ai-copilot.resolver.ts
// - Mutations: generateCourseOutline / transcribeLessonVideo /
//   generateLessonQuiz. Queries: copilotJobStatus / lessonQuizBank.
// - Zero new deps.
import { Args, Field, Float, ID, InputType, Int, Mutation, ObjectType, Query, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { OutlineGeneratorService } from '../services/outline-generator.service';
import { WhisperTranscriberService } from '../services/whisper-transcriber.service';
import { AutoQuizBuilderService } from '../services/auto-quiz-builder.service';

@ObjectType('OutlineLesson')
class OutlineLessonGql {
  @Field()
  lessonTitle!: string;

  @Field()
  outcome!: string;
}

@ObjectType('OutlineSection')
class OutlineSectionGql {
  @Field()
  sectionTitle!: string;

  @Field(() => [OutlineLessonGql])
  lessons!: OutlineLessonGql[];
}

@ObjectType('OutlinePayload')
class OutlinePayloadGql {
  @Field(() => ID)
  jobId!: string;

  @Field(() => [OutlineSectionGql])
  sections!: OutlineSectionGql[];
}

@ObjectType('TranscribePayload')
class TranscribePayloadGql {
  @Field(() => ID)
  jobId!: string;

  @Field(() => Int)
  queued!: number;
}

@ObjectType('CopilotJobStatus')
class CopilotJobStatusGql {
  @Field(() => ID)
  jobId!: string;

  @Field()
  status!: string;

  @Field(() => Int)
  progressPercentage!: number;

  @Field(() => String, { nullable: true })
  errorMessage?: string | null;
}

@ObjectType('GeneratedQuizItem')
class GeneratedQuizItemGql {
  @Field()
  question!: string;

  @Field(() => [String])
  options!: string[];

  @Field(() => Int)
  correctOptionIndex!: number;

  @Field()
  explanation!: string;
}

@InputType('CourseOutlinePromptInput')
class CourseOutlinePromptInputGql {
  @Field()
  topic!: string;

  @Field()
  targetAudience!: string;

  @Field()
  difficultyLevel!: string;

  @Field(() => Int, { nullable: true })
  numberOfSections?: number;
}

type LooseCtx = Record<string, unknown>;

function actorOf(ctx: LooseCtx): string {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Resolver('AiCopilot')
export class AiCopilotResolver {
  constructor(
    private readonly outline: OutlineGeneratorService,
    private readonly transcriber: WhisperTranscriberService,
    private readonly quiz: AutoQuizBuilderService,
    private readonly jobs: {
      findJob(jobId: string, userId: string): Promise<{ id: string; status: string; progressPercent: number; errorMessage: string | null } | null>;
    },
  ) {}

  @Mutation('generateCourseOutline')
  generateCourseOutline(@Args('input') input: CourseOutlinePromptInputGql, @Context() ctx: LooseCtx) {
    return this.outline.generate({ userId: actorOf(ctx), prompt: { ...input } });
  }

  @Mutation('transcribeLessonVideo')
  transcribeLessonVideo(
    @Args('lessonId') lessonId: string,
    @Args('transcriptText') transcriptText: string,
    @Args('durationSec', { type: () => Float }) durationSec: number,
    @Context() ctx: LooseCtx,
  ) {
    return this.transcriber.requestTranscribe({
      userId: actorOf(ctx),
      lessonId,
      transcriptText,
      durationSec,
    });
  }

  @Mutation('generateLessonQuiz')
  generateLessonQuiz(@Args('lessonId') lessonId: string, @Args('transcriptText') transcriptText: string) {
    return this.quiz.buildFromTranscript({ lessonId, transcriptText });
  }

  @Query('copilotJobStatus')
  async copilotJobStatus(@Args('jobId') jobId: string, @Context() ctx: LooseCtx) {
    const userId = actorOf(ctx);
    const row = await this.jobs.findJob(jobId, userId);
    if (!row) throw new BadRequestException('Job not found');
    const out = new CopilotJobStatusGql();
    out.jobId = row.id;
    out.status = row.status;
    out.progressPercentage = row.progressPercent;
    out.errorMessage = row.errorMessage;
    return out;
  }
}

export { OutlinePayloadGql, TranscribePayloadGql, CopilotJobStatusGql, GeneratedQuizItemGql };
