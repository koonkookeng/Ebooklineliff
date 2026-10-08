// SSOT Phase 078 §5 — Studio REST (reorder + HLS presign + quiz)
// Canonical: apps/backend/src/modules/course-studio/presentation/studio.controller.ts
// - POST curriculum/reorder — JWT + TenantGuard + creator role (BDD-1).
// - POST hls/presign — direct-upload URL (BDD-2, MP4/MOV/MKV only).
// - POST quiz / DELETE quiz/:quizId — builder CRUD (BDD-3).
// - GET curriculum/:courseId — owner-scoped structure tree.
// - Zero new deps.
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { ReorderCurriculumUseCase } from '../application/use-cases/reorder-curriculum.use-case';
import { HlsTranscoderService } from '../application/services/hls-transcoder.service';
import { QuizEngineService } from '../application/services/quiz-engine.service';
import type { CourseStudioRepository } from '../domain/repositories/course-studio.repository.interface';
import { PrismaCourseStudioRepository } from '../infrastructure/repositories/prisma-course-studio.repository';
import { assertCourseOwnership, assertStudioTenant } from '../domain/entities/course-section.entity';

function tenantOf(req: Record<string, unknown>): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? headers['X-Tenant-ID'] ?? '') as string).trim();
}

function actorOf(req: Record<string, unknown>): { userId: string; role: string | undefined } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  return { userId: user.id ?? '', role: user.role };
}

function assertCreatorRole(role: string | undefined): void {
  if (role !== 'INSTRUCTOR' && role !== 'SELLER' && role !== 'SUPER_ADMIN') {
    throw new ForbiddenException('Studio access requires a creator role');
  }
}

@Controller('api/v1/studio')
@UseGuards(JwtAuthGuard, TenantGuard)
export class StudioController {
  constructor(
    private readonly reorder: ReorderCurriculumUseCase,
    private readonly transcoder: HlsTranscoderService,
    private readonly quizzes: QuizEngineService,
    private readonly repo: PrismaCourseStudioRepository,
  ) {}

  @Post('curriculum/reorder')
  reorderCurriculum(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    const actor = actorOf(req);
    assertCreatorRole(actor.role);
    return this.reorder.execute(tenantOf(req), actor, body);
  }

  @Post('hls/presign')
  presignHls(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    const actor = actorOf(req);
    assertCreatorRole(actor.role);
    return this.transcoder.presignUpload(tenantOf(req), actor, body);
  }

  @Post('quiz')
  saveQuiz(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    const actor = actorOf(req);
    assertCreatorRole(actor.role);
    return this.quizzes.saveLessonQuiz(tenantOf(req), actor, body);
  }

  @Delete('quiz/:quizId')
  deleteQuiz(@Req() req: Record<string, unknown>, @Param('quizId') quizId: string) {
    const actor = actorOf(req);
    assertCreatorRole(actor.role);
    return this.quizzes.deleteLessonQuiz(tenantOf(req), actor, quizId);
  }

  @Get('curriculum/:courseId')
  async structure(@Req() req: Record<string, unknown>, @Param('courseId') courseId: string) {
    const tenantId = tenantOf(req);
    const actor = actorOf(req);
    const repo: CourseStudioRepository = this.repo;
    const course = await repo.findCourse(courseId);
    if (!course) throw new BadRequestException('Course not found');
    assertStudioTenant(tenantId, course.tenantId);
    assertCourseOwnership(course.sellerId, actor.userId, actor.role);
    return repo.loadStructure(courseId);
  }
}
