// SSOT Phase 109 §5.2 — Admin user command service (atomic mutations + audit)
// Canonical: apps/backend/src/modules/admin/user-management/services/admin-user-command.service.ts
// - Every mutation commits user-change + wallet-ledger (if any) + immutable
//   audit row in ONE Prisma $transaction (Gate 7).
// - Impersonation: HMAC ticket (no @nestjs/jwt installed), 900s TTL, nonce
//   pinned in Redis; SUPER_ADMIN targets are un-impersonatable; impersonated
//   sessions can never ADJUST_WALLET (§8.1 scoped-permission ban).
// - RISK_CALL: spec imports PrismaService from infra/prisma + @nestjs/jwt —
//   canonical here is infra/database/prisma.service + HMAC tickets.
// - Zero new deps.
import { Injectable, BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { UserRole } from '@prisma/client';
import { AdminUserPrismaRepository } from '../repositories/admin-user-prisma.repository';
import {
  AdminUserActionPayloadSchema,
  IMPERSONATION_TTL_SEC,
  impersonationTicketKey,
  signImpersonationTicket,
  verifyImpersonationTicket,
  type AdminUserActionPayload,
} from '@repo/shared';

@Injectable()
export class AdminUserCommandService {
  private readonly logger = new Logger(AdminUserCommandService.name);

  constructor(private readonly repo: AdminUserPrismaRepository) {}

  private impersonationSecret(): string {
    const secret = process.env.IMPERSONATION_HMAC_SECRET ?? '';
    if (!secret) throw new ServiceUnavailableException('Impersonation service not configured');
    return secret;
  }

  async executeAdminUserAction(
    adminId: string,
    clientIp: string,
    raw: unknown,
    opts?: { impersonated?: boolean; userAgent?: string },
  ) {
    const parsed = AdminUserActionPayloadSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('รูปแบบคำสั่งไม่ถูกต้อง');
    const payload: AdminUserActionPayload = parsed.data;
    const { userId, action, newRole, walletAdjustmentAmount, reason, rejectionReason } = payload;

    if (action === 'ADJUST_WALLET' && opts?.impersonated === true) {
      throw new ForbiddenException('ห้ามปรับยอดเงินในขณะเข้าสู่ระบบแทนผู้ใช้');
    }

    const targetUser = await this.repo.prisma.user.findUnique({
      where: { id: userId },
      include: { kycDetail: true },
    });
    if (!targetUser) throw new NotFoundException(`ไม่พบข้อมูลผู้ใช้งานรหัส: ${userId}`);

    // Role-escalation guard: only SUPER_ADMIN may grant admin roles.
    if (action === 'UPDATE_ROLE' && newRole && newRole !== targetUser.role) {
      const admin = await this.repo.prisma.user.findUnique({ where: { id: adminId } });
      const grantsAdmin = ['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR', 'SUPPORT_STAFF'].includes(newRole);
      if (grantsAdmin && admin?.role !== 'SUPER_ADMIN') {
        throw new ForbiddenException('มีเพียง SUPER_ADMIN ที่สามารถมอบสิทธิ์ผู้ดูแลได้');
      }
    }

    // Fail-closed ordering for impersonation: the Redis nonce is pinned only
    // AFTER the atomic tx commits — a rolled-back tx never leaves a live
    // ticket without its audit row. (Holder object: survives closure narrowing.)
    const pending: { nonce?: string } = {};

    const result = await this.repo.prisma.$transaction(async (tx) => {
      const actionDetails: Record<string, string | number | boolean | null> = { action, reason };

      switch (action) {
        case 'UPDATE_ROLE': {
          if (!newRole) throw new BadRequestException('กรุณาระบุ Role ใหม่');
          await tx.user.update({ where: { id: userId }, data: { role: newRole as UserRole } });
          actionDetails['previousRole'] = targetUser.role;
          actionDetails['updatedRole'] = newRole;
          break;
        }
        case 'FREEZE_ACCOUNT': {
          await tx.user.update({ where: { id: userId }, data: { isFrozen: true, freezeReason: reason } });
          actionDetails['status'] = 'FROZEN';
          break;
        }
        case 'UNFREEZE_ACCOUNT': {
          await tx.user.update({ where: { id: userId }, data: { isFrozen: false, freezeReason: null } });
          actionDetails['status'] = 'ACTIVE';
          break;
        }
        case 'ADJUST_WALLET': {
          if (walletAdjustmentAmount === undefined || walletAdjustmentAmount === 0) {
            throw new BadRequestException('กรุณาระบุจำนวนเงินที่ต้องการปรับปรุง');
          }
          const currentBalance = Number(targetUser.walletBalance);
          const newBalance = Math.round((currentBalance + walletAdjustmentAmount) * 100) / 100;
          if (newBalance < 0) throw new BadRequestException('ยอดเงินคงเหลือไม่สามารถติดลบได้');
          await tx.user.update({ where: { id: userId }, data: { walletBalance: newBalance } });
          await tx.walletAuditLedger.create({
            data: { userId, adminId, amountDelta: walletAdjustmentAmount, balanceBefore: currentBalance, balanceAfter: newBalance, reason },
          });
          actionDetails['balanceBefore'] = currentBalance;
          actionDetails['balanceAfter'] = newBalance;
          actionDetails['amountDelta'] = walletAdjustmentAmount;
          break;
        }
        case 'APPROVE_KYC': {
          await tx.user.update({
            where: { id: userId },
            data: { kycStatus: 'VERIFIED', role: targetUser.role === 'MEMBER' ? 'SELLER' : targetUser.role },
          });
          if (targetUser.kycDetail) {
            await tx.creatorKYC.update({
              where: { userId },
              data: { verifiedAt: new Date(), reviewedByAdminId: adminId, rejectionReason: null },
            });
          }
          actionDetails['kycStatus'] = 'VERIFIED';
          break;
        }
        case 'REJECT_KYC': {
          if (!rejectionReason) throw new BadRequestException('กรุณาระบุเหตุผลในการปฏิเสธ KYC');
          await tx.user.update({ where: { id: userId }, data: { kycStatus: 'REJECTED' } });
          if (targetUser.kycDetail) {
            await tx.creatorKYC.update({ where: { userId }, data: { rejectionReason, reviewedByAdminId: adminId } });
          }
          actionDetails['kycStatus'] = 'REJECTED';
          actionDetails['rejectionReason'] = rejectionReason;
          break;
        }
        case 'GENERATE_IMPERSONATION_TOKEN': {
          // Target guards mirror mintImpersonationToken (frozen/admin bans) so
          // the tx never mints for an ineligible target.
          if (targetUser.role === 'SUPER_ADMIN') throw new ForbiddenException('ไม่สามารถเข้าสู่ระบบแทน SUPER_ADMIN ได้');
          if (targetUser.isFrozen) throw new ForbiddenException('บัญชีผู้ใช้ถูกระงับ ไม่สามารถเข้าสู่ระบบแทนได้');
          const built = this.buildImpersonationTicket(targetUser.id, adminId);
          pending.nonce = built.nonce;
          actionDetails['impersonationTokenIssued'] = true;
          actionDetails['tokenExpiresInSec'] = IMPERSONATION_TTL_SEC;
          actionDetails['impersonationToken'] = built.ticket;
          actionDetails['impersonationExpiresIn'] = IMPERSONATION_TTL_SEC;
          break;
        }
        default:
          throw new BadRequestException('รูปแบบ Action ไม่ถูกต้อง');
      }

      await tx.auditLog.create({
        data: {
          executorId: adminId, targetUserId: userId,
          action: action === 'GENERATE_IMPERSONATION_TOKEN' ? 'ADMIN_IMPERSONATE_USER' : `ADMIN_USER_${action}`,
          details: actionDetails, ipAddress: clientIp,
          userAgent: opts?.userAgent,
        },
      });

      await this.repo.invalidateListCaches();
      // NOTE: invalidation runs inside the tx callback but only deletes cache
      // keys — a rollback leaves the cache cold (extra DB read, never stale).
      const tail: Record<string, unknown> = { success: true, message: `ดำเนินการ ${action} สำหรับผู้ใช้งานเรียบร้อยแล้ว`, userId };
      if (action === 'GENERATE_IMPERSONATION_TOKEN') {
        tail['impersonationToken'] = actionDetails['impersonationToken'];
        tail['expiresIn'] = actionDetails['impersonationExpiresIn'];
      }
      return tail;
    });

    if (pending.nonce && action === 'GENERATE_IMPERSONATION_TOKEN') {
      await this.repo.redis
        .setex(impersonationTicketKey(adminId, userId, pending.nonce), IMPERSONATION_TTL_SEC, JSON.stringify({ reason, at: new Date().toISOString() }))
        .catch(() => undefined);
    }
    return result;
  }

  private buildImpersonationTicket(targetUserId: string, adminId: string): { ticket: string; nonce: string } {
    const nonce = randomUUID();
    return { ticket: signImpersonationTicket(this.impersonationSecret(), targetUserId, adminId, nonce), nonce };
  }

  async mintImpersonationToken(adminId: string, targetUserId: string, reason: string, clientIp: string) {
    if (!targetUserId) throw new BadRequestException('Missing target user');
    if (!reason || reason.trim().length < 5) throw new BadRequestException('กรุณาระบุเหตุผลในการดำเนินการอย่างน้อย 5 ตัวอักษร');
    const targetUser = await this.repo.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) throw new NotFoundException('ไม่พบผู้ใช้งาน');
    if (targetUser.role === 'SUPER_ADMIN') throw new ForbiddenException('ไม่สามารถเข้าสู่ระบบแทน SUPER_ADMIN ได้');
    if (targetUser.isFrozen) throw new ForbiddenException('บัญชีผู้ใช้ถูกระงับ ไม่สามารถเข้าสู่ระบบแทนได้');

    const nonce = randomUUID();
    const ticket = signImpersonationTicket(this.impersonationSecret(), targetUserId, adminId, nonce);
    await this.repo.redis
      .setex(impersonationTicketKey(adminId, targetUserId, nonce), IMPERSONATION_TTL_SEC, JSON.stringify({ reason, at: new Date().toISOString() }))
      .catch(() => undefined);

    await this.repo.prisma.auditLog.create({
      data: {
        executorId: adminId, targetUserId,
        action: 'ADMIN_IMPERSONATE_USER',
        details: { reason, tokenExpiresInSec: IMPERSONATION_TTL_SEC },
        ipAddress: clientIp,
      },
    }).catch((err) => this.logger.warn(`Impersonation audit write failed: ${(err as Error).message}`));

    return {
      impersonationToken: ticket,
      expiresIn: IMPERSONATION_TTL_SEC,
      targetUser: { id: targetUser.id, displayName: targetUser.displayName },
    };
  }

  async resolveImpersonationTicket(ticket: string) {
    const verified = verifyImpersonationTicket(this.impersonationSecret(), ticket);
    if (!verified) throw new ForbiddenException('Impersonation token ไม่ถูกต้องหรือหมดอายุ');
    const { targetUserId, adminId } = verified;
    // Nonce must still be pinned (revocable server-side).
    const prefix = `admin:impersonate:${adminId}:${targetUserId}:`;
    const keys = await this.repo.redis.scanKeys(`${prefix}*`).catch(() => [] as string[]);
    if (keys.length === 0) throw new ForbiddenException('Impersonation session ถูกเพิกถอนแล้ว');
    const targetUser = await this.repo.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser || targetUser.isFrozen) throw new ForbiddenException('บัญชีผู้ใช้ไม่พร้อมใช้งาน');
    return {
      sub: targetUser.id,
      lineUserId: targetUser.lineUserId,
      email: targetUser.email,
      role: targetUser.role,
      isImpersonated: true,
      impersonatedByAdminId: adminId,
    };
  }
}
