// SSOT Phase 107 Task 2/4/7 — PiiService (vault upsert + gated unmask + audit stream)
// Canonical: apps/backend/src/modules/pii/pii.service.ts
// - upsertUserPii encrypts phone/bank/idCard + blind hashes in ONE $transaction (Gate 7).
// - requestUnmask enforces DataScopePolicy (row or §8.2 default matrix) + reason
//   length + 50/day quota (Redis INCRBY, 24h TTL) + audit row + XADD event.
// - Audit payloads NEVER carry plaintext (Gate 4/8); Redis failures are fail-open
//   for reads but fail-closed for quota increments (fail-closed spend).
// - Zero new deps.
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import {
  PII_AUDIT_STREAM,
  PII_UNMASK_MAX_PER_DAY,
  PII_UNMASK_TTL_SEC,
  UnmaskRequestSchema,
  piiAuditKey,
  type SensitiveFieldType,
} from '@repo/shared';

export type DataScopeRoleName =
  | 'SUPER_ADMIN'
  | 'TENANT_ADMIN'
  | 'COMPLIANCE_OFFICER'
  | 'SUPPORT_STAFF'
  | 'FULFILLMENT_OPERATOR'
  | 'MEMBER';

interface PrismaPort {
  userPII: {
    upsert(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<Record<string, unknown> | null>;
  };
  dataScopePolicy: {
    findUnique(args: unknown): Promise<{ canUnmask: boolean; maxUnmasksPerDay: number } | null>;
  };
  pIIAccessAuditLog: {
    create(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: PrismaPort) => Promise<T>): Promise<T>;
}

interface RedisPort {
  incrby(key: string, n: number): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  xaddPipeline(streamKey: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

function dayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** §8.2 default matrix when no DataScopePolicy row exists for (tenant, role). */
export function defaultCanUnmask(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'COMPLIANCE_OFFICER' || role === 'TENANT_ADMIN' || role === 'SUPPORT_STAFF';
}

const FIELD_COLUMN: Record<'PHONE_NUMBER' | 'BANK_ACCOUNT' | 'NATIONAL_ID' | 'TAX_ID', 'encryptedPhone' | 'encryptedBankAccount' | 'encryptedIdCard'> = {
  PHONE_NUMBER: 'encryptedPhone',
  BANK_ACCOUNT: 'encryptedBankAccount',
  NATIONAL_ID: 'encryptedIdCard',
  TAX_ID: 'encryptedIdCard',
};

@Injectable()
export class PiiService {
  constructor(
    private readonly prisma: PrismaPort,
    private readonly redis: RedisPort,
    private readonly crypto: FieldEncryptionService,
  ) {}

  /** BDD Scenario 1: plaintext -> envelopes + blind hashes, atomically (never raw on disk). */
  async upsertUserPii(userId: string, input: { phone?: string; bankAccount?: string; idCard?: string }): Promise<void> {
    if (!userId) throw new BadRequestException('userId required');
    const data: Record<string, unknown> = {};
    if (input.phone) {
      data['encryptedPhone'] = this.crypto.encrypt(input.phone);
      data['phoneHash'] = this.crypto.blindIndex(input.phone);
    }
    if (input.bankAccount) {
      data['encryptedBankAccount'] = this.crypto.encrypt(input.bankAccount);
      data['bankAccountHash'] = this.crypto.blindIndex(input.bankAccount);
    }
    if (input.idCard) {
      data['encryptedIdCard'] = this.crypto.encrypt(input.idCard);
      data['idCardHash'] = this.crypto.blindIndex(input.idCard);
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('No PII fields provided');
    await this.prisma.$transaction(async (tx) => {
      await tx.userPII.upsert({
        where: { userId },
        create: { userId, ...data },
        update: { ...data },
      });
    });
  }

  /** Exact-match lookup by blind index (no decryption, §8.1). */
  async findUserIdByPhone(phone: string): Promise<string | null> {
    const hash = this.crypto.blindIndex(phone);
    const row = await this.prisma.userPII.findUnique({ where: { phoneHash: hash } });
    return (row?.['userId'] as string) ?? null;
  }

  async requestUnmask(input: {
    actorUserId: string;
    actorRole: string;
    tenantId: string;
    targetUserId: string;
    fieldType: SensitiveFieldType;
    reason: string;
    ipAddress: string;
    userAgent: string;
  }): Promise<{ plainText: string; expiresInSec: number }> {
    const parsed = UnmaskRequestSchema.safeParse({
      targetEntityId: input.targetUserId,
      fieldType: input.fieldType,
      reason: input.reason,
    });
    if (!parsed.success) throw new BadRequestException('Invalid unmask request');

    const isSelf = input.actorUserId === input.targetUserId;
    let canUnmask: boolean;
    let quota = PII_UNMASK_MAX_PER_DAY;
    if (isSelf) {
      canUnmask = true; // gatekeeper matrix §8.2 MEMBER (Owner) row
    } else {
      const policy = await this.prisma.dataScopePolicy.findUnique({
        where: { tenantId_role: { tenantId: input.tenantId, role: input.actorRole } },
      });
      canUnmask = policy?.canUnmask ?? defaultCanUnmask(input.actorRole);
      quota = policy?.maxUnmasksPerDay ?? PII_UNMASK_MAX_PER_DAY;
      if (!canUnmask) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงข้อมูลส่วนบุคคลนี้');
      const count = await this.redis.incrby(piiAuditKey(input.actorUserId, dayKey()), 1);
      if (count === 1) await this.redis.expire(piiAuditKey(input.actorUserId, dayKey()), 86400);
      if (count > quota) throw new ForbiddenException('Daily unmask quota exceeded');
    }

    // Only vault-backed field types can be unmasked (vault stores phone/bank/idCard).
    if (input.fieldType !== 'PHONE_NUMBER' && input.fieldType !== 'BANK_ACCOUNT' && input.fieldType !== 'NATIONAL_ID' && input.fieldType !== 'TAX_ID') {
      throw new BadRequestException('Field type is not stored in the PII vault');
    }
    const vault = await this.prisma.userPII.findUnique({ where: { userId: input.targetUserId } });
    if (!vault) throw new BadRequestException('PII vault not found');
    const envelope = vault[FIELD_COLUMN[input.fieldType]] as
      | { ciphertext: string; iv: string; authTag: string; keyVersion: number }
      | null
      | undefined;
    if (!envelope) throw new BadRequestException('Field not stored for this user');
    const plainText = this.crypto.decrypt(envelope);

    // Append-only audit (metadata only — Gate 4) + Redis stream fan-out (Gate 8, fail-open).
    const auditRow = {
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      fieldType: input.fieldType,
      accessScope: input.actorRole as DataScopeRoleName,
      actionReason: input.reason,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    };
    await this.prisma.pIIAccessAuditLog.create({ data: auditRow });
    try {
      await this.redis.xaddPipeline(PII_AUDIT_STREAM, [
        {
          eventId: `${Date.now()}-${input.actorUserId}`,
          timestamp: new Date().toISOString(),
          actorUserId: input.actorUserId,
          targetUserId: input.targetUserId,
          fieldType: input.fieldType,
          action: isSelf ? 'SELF_VIEW' : 'UNMASK_VIEW',
          ipAddress: input.ipAddress,
          grantedScope: input.actorRole,
          hasOtpVerified: 1,
        },
      ]);
    } catch {
      // Audit stream is telemetry: a Redis outage must not leak plaintext via a 500
      // stack — the DB audit row above is the source of truth.
    }
    return { plainText, expiresInSec: PII_UNMASK_TTL_SEC };
  }
}
