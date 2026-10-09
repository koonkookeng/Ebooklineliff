// SSOT Phase 098 — B2B HR REST (HR JWT + PDF export)
// Canonical: apps/backend/src/modules/b2b-hr/controllers/b2b-export.controller.ts
// - GET analytics (cached dashboard) / GET export-pdf (dep-free sealed PDF)
//   / POST allocate / POST quiz-attempt. Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { B2bHrSeatService } from '../services/b2b-seat.service';
import { B2bHrQuizTrackerService } from '../services/b2b-quiz-tracker.service';
import { B2bHrAnalyticsService } from '../services/b2b-analytics.service';
import { HrReportGeneratorService } from '../../../infra/pdf/hr-report-generator.service';

interface PdfReply {
  setHeader: (key: string, value: string) => unknown;
  send: (body: unknown) => unknown;
}

@Controller('api/v1/b2b-hr')
export class B2bExportController {
  constructor(
    private readonly seats: B2bHrSeatService,
    private readonly quizzes: B2bHrQuizTrackerService,
    private readonly analytics: B2bHrAnalyticsService,
    private readonly reports: HrReportGeneratorService,
  ) {}

  @Get('analytics')
  @UseGuards(JwtAuthGuard, TenantGuard)
  analyticsOf(@Query('orgId') orgId: string | undefined) {
    if (!orgId) throw new BadRequestException('Missing orgId');
    return this.analytics.dashboard(orgId);
  }

  @Get('export-pdf')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async exportPdf(@Query('orgId') orgId: string | undefined, @Res() res: PdfReply) {
    if (!orgId) throw new BadRequestException('Missing orgId');
    const d = await this.analytics.dashboard(orgId);
    const { pdf, seal } = this.reports.build({
      organizationId: d.organizationId,
      companyName: d.companyName,
      totalSeats: d.totalSeats,
      usedSeats: d.usedSeats,
      utilization: d.utilization,
      completionRate: d.completionRate,
      averageScore: d.averageScore,
      passed: d.passed,
      failed: d.failed,
      departments: d.departments,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Report-Seal', seal);
    res.setHeader('Content-Disposition', `attachment; filename="hr-report-${orgId}.pdf"`);
    res.send(pdf);
  }

  @Post('allocate')
  @UseGuards(JwtAuthGuard, TenantGuard)
  allocate(@Body() body: unknown) {
    const b = (body ?? {}) as {
      organizationId?: string; departmentId?: string; emails?: string[]; lineUserIds?: string[];
    };
    if (!b.organizationId) throw new BadRequestException('Missing organizationId');
    return this.seats.allocateSeats({
      organizationId: b.organizationId,
      departmentId: b.departmentId,
      emails: b.emails,
      lineUserIds: b.lineUserIds,
    });
  }

  @Post('quiz-attempt')
  @UseGuards(JwtAuthGuard, TenantGuard)
  quizAttempt(@Body() body: unknown) {
    const b = (body ?? {}) as {
      seatId?: string; courseId?: string; quizId?: string;
      scoreObtained?: number; maxScore?: number; passingScore?: number; timeTakenSec?: number;
    };
    if (!b.seatId || !b.courseId || !b.quizId) throw new BadRequestException('Missing seatId/courseId/quizId');
    if (typeof b.scoreObtained !== 'number' || typeof b.maxScore !== 'number' || typeof b.timeTakenSec !== 'number') {
      throw new BadRequestException('Invalid score payload');
    }
    return this.quizzes.recordAttempt({
      seatId: b.seatId,
      courseId: b.courseId,
      quizId: b.quizId,
      scoreObtained: b.scoreObtained,
      maxScore: b.maxScore,
      passingScore: b.passingScore,
      timeTakenSec: b.timeTakenSec,
    });
  }
}
