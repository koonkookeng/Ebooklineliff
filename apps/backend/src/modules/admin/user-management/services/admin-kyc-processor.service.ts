// SSOT Phase 109 §5.1/§8.1 — Admin KYC processor (reads + presigned docs)
// Canonical: apps/backend/src/modules/admin/user-management/services/admin-kyc-processor.service.ts
// - Mutations delegate to AdminUserCommandService (single atomic writer).
// - KYC doc URLs are 120s SigV4 presigned GETs from the R2 private vault
//   (Gate 6: zero egress; 503 when R2 unconfigured — never fabricated).
// - Zero new deps.
import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { AdminUserPrismaRepository } from '../repositories/admin-user-prisma.repository';
import { AdminUserCommandService } from './admin-user-command.service';
import { R2StorageService } from '../../../../infra/cloudflare/r2-storage.service';
import { KYC_PRESIGN_TTL_SEC, KycPendingItemSchema } from '@repo/shared';

@Injectable()
export class AdminKycProcessorService {
  private readonly logger = new Logger(AdminKycProcessorService.name);

  constructor(
    private readonly repo: AdminUserPrismaRepository,
    private readonly commands: AdminUserCommandService,
    private readonly r2: R2StorageService,
  ) {}

  async getPendingList(page = 1, pageSize = 20) {
    const take = Math.min(Math.max(1, pageSize), 100);
    const skip = (Math.max(1, page) - 1) * take;
    const where = { kycStatus: 'PENDING' as const };
    const [rows, total] = await Promise.all([
      this.repo.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take,
        include: { kycDetail: true },
      }),
      this.repo.prisma.user.count({ where }),
    ]);
    const items = rows.map((u) =>
      KycPendingItemSchema.parse({
        userId: u.id,
        displayName: u.displayName,
        email: u.email ?? null,
        phone: u.phone ?? null,
        kycStatus: u.kycStatus,
        idCardImageUrl: u.kycDetail?.idCardImageUrl ?? null,
        bankName: u.kycDetail?.bankName ?? null,
        bankAccountName: u.kycDetail?.bankAccountName ?? null,
        submittedAt: (u.kycDetail?.createdAt ?? u.createdAt).toISOString(),
      }),
    );
    return { items, total, page, pageSize: take, totalPages: Math.ceil(total / take) };
  }

  async approveKYC(adminId: string, userId: string, clientIp: string, reason = 'KYC ตรวจสอบผ่าน') {
    return this.commands.executeAdminUserAction(
      adminId,
      clientIp,
      { userId, action: 'APPROVE_KYC', reason },
    );
  }

  async rejectKYC(adminId: string, userId: string, clientIp: string, rejectionReason: string) {
    if (!rejectionReason || rejectionReason.trim().length < 5) {
      throw new BadRequestException('กรุณาระบุเหตุผลในการปฏิเสธ KYC');
    }
    return this.commands.executeAdminUserAction(
      adminId,
      clientIp,
      { userId, action: 'REJECT_KYC', reason: `ปฏิเสธ KYC: ${rejectionReason}`, rejectionReason },
    );
  }

  /** Time-boxed KYC document URLs for the inspection drawer (§8.1). */
  async getKycDocumentUrls(adminId: string, userId: string, clientIp: string) {
    const user = await this.repo.prisma.user.findUnique({
      where: { id: userId },
      include: { kycDetail: true },
    });
    if (!user?.kycDetail) throw new NotFoundException(`ไม่พบเอกสาร KYC ของผู้ใช้: ${userId}`);
    const keys = [user.kycDetail.idCardImageUrl, user.kycDetail.selfieImageUrl, user.kycDetail.bookbankImageUrl].filter(
      (k): k is string => !!k,
    );
    const urls = keys.map((key) => ({
      objectKey: key,
      url: this.r2.presignedGetUrl(key, KYC_PRESIGN_TTL_SEC),
      expiresIn: KYC_PRESIGN_TTL_SEC,
    }));

    // View audit (best-effort; never blocks inspection).
    await this.repo.prisma.auditLog
      .create({
        data: {
          executorId: adminId, targetUserId: userId,
          action: 'ADMIN_VIEW_KYC_DOCS',
          details: { documentCount: urls.length },
          ipAddress: clientIp,
        },
      })
      .catch((err) => this.logger.warn(`KYC view audit failed: ${(err as Error).message}`));

    return { userId, urls };
  }
}
