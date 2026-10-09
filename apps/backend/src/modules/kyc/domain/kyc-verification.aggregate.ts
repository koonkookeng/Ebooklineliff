// SSOT Phase 085 §5 — KYC verification aggregate guards
// Canonical: apps/backend/src/modules/kyc/domain/kyc-verification.aggregate.ts
// - Submission gate: ID checksum + laser linkage must pass before any
//   PENDING row exists (BDD-1 <3s synchronous bar).
// - Decision gate: only PENDING/ACTION_REQUIRED rows move; VERIFIED writes
//   verifiedAt + actor; REJECTED needs a reason (PDPA-actionable).
// - Zero new deps.
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { laserFormatValid, thaiIdChecksum } from '@repo/shared';

export function assertSubmittable(args: { idCardNumber: string; laserCode: string }): void {
  if (!thaiIdChecksum(args.idCardNumber)) {
    throw new BadRequestException('เลขบัตรประชาชน 13 หลักไม่ถูกต้อง');
  }
  if (!laserFormatValid(args.laserCode)) {
    throw new BadRequestException('รหัสหลังบัตรประชาชนต้องมี 12 หลัก (2 อักษร + 10 ตัวเลข)');
  }
  if (!args.idCardNumber.includes(args.laserCode.slice(-4))) {
    throw new BadRequestException('รหัสหลังบัตรไม่สัมพันธ์กับเลขบัตรประชาชน');
  }
}

export function assertDecidable(currentStatus: string): void {
  if (currentStatus !== 'PENDING' && currentStatus !== 'ACTION_REQUIRED') {
    throw new ForbiddenException(`KYC in status ${currentStatus} cannot be decided`);
  }
}

export function assertRejection(action: { status: string; rejectionReason?: string }): void {
  if (action.status === 'REJECTED' && !action.rejectionReason?.trim()) {
    throw new BadRequestException('Rejection requires a reason');
  }
}
