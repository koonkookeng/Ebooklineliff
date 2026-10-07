// SSOT Phase 035 Task 2 — Review verifier (latest-audit read path)
// Canonical: apps/backend/src/modules/line-sandbox/services/line-review-verifier.service.ts
// (legacy src/backend/modules/line-sandbox/services/line-review-verifier.service.ts)
// - latestAudit: single indexed read (tenantId) with items included (no N+1);
//   null when the tenant never audited (client shows IDLE, not an error).
// - Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import type { LineReviewAuditSummary } from '@repo/shared';

interface VerifierTables {
  lineMiniAppSandboxAudit: {
    findFirst: (args: unknown) => Promise<{
      id: string;
      tenantId: string;
      overallScore: number;
      isApprovedForSubmission: boolean;
      createdAt: Date;
      testResults: Array<{
        id: string;
        category: string;
        checkPointName: string;
        isPassed: boolean;
        executionTimeMs: number;
        memoryUsageMB: number;
        diagnosticMessage: string | null;
      }>;
    } | null>;
  };
}

@Injectable()
export class LineReviewVerifierService {
  constructor(private readonly prisma: PrismaService) {}

  async latestAudit(tenantId: string): Promise<LineReviewAuditSummary | null> {
    if (!tenantId) throw new BadRequestException('Missing tenant id');
    const row = await (this.prisma as unknown as VerifierTables).lineMiniAppSandboxAudit
      .findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' }, include: { testResults: true } })
      .catch(() => null);
    if (!row) return null;
    return {
      auditId: row.id,
      tenantId: row.tenantId,
      overallScore: row.overallScore,
      isApprovedForSubmission: row.isApprovedForSubmission,
      results: row.testResults.map((t) => ({
        testId: t.id,
        category: t.category as LineReviewAuditSummary['results'][number]['category'],
        checkPointName: t.checkPointName,
        isPassed: t.isPassed,
        executionTimeMs: t.executionTimeMs,
        memoryUsageMB: t.memoryUsageMB,
        ...(t.diagnosticMessage ? { diagnosticMessage: t.diagnosticMessage } : {}),
      })),
      timestamp: row.createdAt.toISOString(),
    };
  }
}
