// SSOT Phase 078 §3.2/Gate 1 — Course studio GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/course-studio/presentation/course-studio.resolver.ts
// - reorderCurriculum / generateHlsUploadUrl / saveLessonQuiz /
//   deleteLessonQuiz behind the authenticated gateway.
// - Zero new deps.
import { Args, Field, Float, ID, InputType, Int, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ReorderCurriculumUseCase } from '../application/use-cases/reorder-curriculum.use-case';
import { HlsTranscoderService } from '../application/services/hls-transcoder.service';
import { QuizEngineService } from '../application/services/quiz-engine.service';
import type { CourseStudioRepository } from '../domain/repositories/course-studio.repository.interface';
import { PrismaCourseStudioRepository } from '../infrastructure/repositories/prisma-course-studio.repository';

@ObjectType('StudioQuizOptionRow')
class StudioQuizOptionRowGql {
  @Field(() => ID) id!: string;
  @Field() optionText!: string;
  @Field() isCorrect!: boolean;
}

@ObjectType('StudioLessonQuizRow')
class StudioLessonQuizRowGql {
  @Field(() => ID) id!: string;
  @Field(() => ID) lessonId!: string;
  @Field() question!: string;
  @Field({ nullable: true }) explanation?: string | null;
  @Field(() => Int) points!: number;
  @Field(() => [StudioQuizOptionRowGql]) options!: StudioQuizOptionRowGql[];
}

@ObjectType('StudioLessonRow')
class StudioLessonRowGql {
  @Field(() => ID) id!: string;
  @Field(() => ID) sectionId!: string;
  @Field(() => Int) lessonOrder!: number;
  @Field() title!: string;
  @Field({ nullable: true }) videoHlsUrl?: string | null;
  @Field(() => Int) durationSec!: number;
  @Field() isPreview!: boolean;
}

@ObjectType('StudioSectionRow')
class StudioSectionRowGql {
  @Field(() => ID) id!: string;
  @Field(() => ID) courseId!: string;
  @Field(() => Int) sectionOrder!: number;
  @Field() title!: string;
  @Field(() => [StudioLessonRowGql]) lessons!: StudioLessonRowGql[];
}

@ObjectType('PresignedHlsUploadPayload')
class PresignedHlsUploadPayloadGql {
  @Field() uploadUrl!: string;
  @Field() videoKey!: string;
  @Field(() => Int) expiresInSec!: number;
}

@InputType('StudioReorderLessonInput')
class StudioReorderLessonInputGql {
  @Field(() => ID) lessonId!: string;
  @Field(() => Int) lessonOrder!: number;
}

@InputType('StudioReorderSectionInput')
class StudioReorderSectionInputGql {
  @Field(() => ID) sectionId!: string;
  @Field(() => Int) sectionOrder!: number;
  @Field(() => [StudioReorderLessonInputGql]) lessons!: StudioReorderLessonInputGql[];
}

@InputType('StudioCurriculumReorderInput')
class StudioCurriculumReorderInputGql {
  @Field(() => ID) courseId!: string;
  @Field(() => [StudioReorderSectionInputGql]) sections!: StudioReorderSectionInputGql[];
}

@InputType('StudioQuizOptionInput')
class StudioQuizOptionInputGql {
  @Field(() => ID, { nullable: true }) id?: string | null;
  @Field() optionText!: string;
  @Field() isCorrect!: boolean;
}

@InputType('StudioSaveQuizInput')
class StudioSaveQuizInputGql {
  @Field(() => ID, { nullable: true }) id?: string | null;
  @Field(() => ID) lessonId!: string;
  @Field() question!: string;
  @Field({ nullable: true }) explanation?: string | null;
  @Field(() => Int, { nullable: true }) points?: number | null;
  @Field(() => [StudioQuizOptionInputGql]) options!: StudioQuizOptionInputGql[];
}

function gqlCtx(ctx: Record<string, unknown>): { userId: string; role: string | undefined; tenantId: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const tenantId = (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '') as string).trim();
  if (!user.id || !tenantId) throw new BadRequestException('Missing creator/tenant context');
  return { userId: user.id, role: user.role, tenantId };
}

@Resolver('CourseStudio')
export class CourseStudioResolver {
  constructor(
    private readonly reorder: ReorderCurriculumUseCase,
    private readonly transcoder: HlsTranscoderService,
    private readonly quizzes: QuizEngineService,
    private readonly repo: PrismaCourseStudioRepository,
  ) {}

  @Query('getStudioCurriculum')
  getStudioCurriculum(@Args('courseId') courseId: string, @Context() ctx: Record<string, unknown>) {
    const { tenantId } = gqlCtx(ctx);
    if (!courseId) throw new BadRequestException('Missing courseId');
    const repo: CourseStudioRepository = this.repo;
    return repo.loadStructure(courseId).then((s) => ({ tenantId, ...s }));
  }

  @Mutation('reorderCurriculum')
  reorderCurriculum(@Args('input') input: StudioCurriculumReorderInputGql, @Context() ctx: Record<string, unknown>) {
    const { userId, role, tenantId } = gqlCtx(ctx);
    return this.reorder.execute(tenantId, { userId, role }, { tenantId, ...input });
  }

  @Mutation('generateHlsUploadUrl')
  generateHlsUploadUrl(
    @Args('lessonId') lessonId: string,
    @Args('fileName') fileName: string,
    @Args('fileSizeBytes', { type: () => Float }) fileSizeBytes: number,
    @Context() ctx: Record<string, unknown>,
  ) {
    const { userId, role, tenantId } = gqlCtx(ctx);
    return this.transcoder.presignUpload(tenantId, { userId, role }, {
      tenantId,
      lessonId,
      fileName,
      fileSizeBytes,
      contentType: 'video/mp4',
    });
  }

  @Mutation('saveLessonQuiz')
  saveLessonQuiz(@Args('input') input: StudioSaveQuizInputGql, @Context() ctx: Record<string, unknown>) {
    const { userId, role, tenantId } = gqlCtx(ctx);
    return this.quizzes.saveLessonQuiz(tenantId, { userId, role }, {
      ...input,
      options: input.options.map((o) => ({ ...o, id: o.id ?? randomUUID() })),
    });
  }

  @Mutation('deleteLessonQuiz')
  deleteLessonQuiz(@Args('quizId') quizId: string, @Context() ctx: Record<string, unknown>) {
    const { userId, role, tenantId } = gqlCtx(ctx);
    return this.quizzes.deleteLessonQuiz(tenantId, { userId, role }, quizId);
  }
}
