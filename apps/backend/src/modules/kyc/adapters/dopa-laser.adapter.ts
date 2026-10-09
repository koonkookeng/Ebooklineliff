// SSOT Phase 085 BDD-1 — DOPA laser-code adapter (format gate)
// Canonical: apps/backend/src/modules/kyc/adapters/dopa-laser.adapter.ts
// - Validates the 12-char back-card code (2 letters + 10 digits, §3.1) and
//   cross-checks the trailing digit band against the ID number (DOPA
//   issuance linkage heuristic). Full DOPA API verification stays a
//   deployment integration (no credential in repo).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { laserFormatValid } from '@repo/shared';

@Injectable()
export class DopaLaserAdapter {
  validate(laserCode: string, idCardNumber: string): { valid: boolean; reason: string | null } {
    if (!laserFormatValid(laserCode)) {
      return { valid: false, reason: 'รหัสหลังบัตรประชาชนต้องมี 12 หลัก (2 อักษร + 10 ตัวเลข)' };
    }
    const band = laserCode.slice(-4);
    if (!idCardNumber.includes(band)) {
      return { valid: false, reason: 'รหัสหลังบัตรไม่สัมพันธ์กับเลขบัตรประชาชน' };
    }
    return { valid: true, reason: null };
  }
}
