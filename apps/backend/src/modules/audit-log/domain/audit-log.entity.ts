// SSOT Phase 118 Task 3 §5.1 — audit domain entity (append-only guards)
// Canonical: apps/backend/src/modules/audit-log/domain/audit-log.entity.ts
// (legacy src/backend/modules/audit-log/domain/audit-log.entity.ts)
// - assertAppendable: the ONLY permitted mutation is CREATE (updates and
//   deletes are rejected at the domain layer; the PostgreSQL trigger in
//   packages/db/prisma/audit-immutability.trigger.sql enforces the same at
//   the engine layer).
// - assertActor: every entry carries an authenticated admin context.
// - Pure. Zero new deps.
import { BadRequestException, ForbiddenException } from '@nestjs/common';

export const AUDIT_ROLES = ['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR', 'SUPPORT_STAFF', 'INSTRUCTOR', 'SELLER'] as const;

export const AUDIT_VIEWER_ROLES = ['SUPER_ADMIN', 'FINANCE_ADMIN'];

export interface AuditActorContext {
  id: string;
  role: string;
  email: string;
  ipAddress: string;
  userAgent: string;
}

/** Only SUPER_ADMIN/FINANCE_ADMIN-class roles may write audit entries. */
export function assertAuditableRole(role: string | undefined): asserts role is string {
  if (!role || !(AUDIT_ROLES as readonly string[]).includes(role)) {
    throw new ForbiddenException('Audit writes require an admin role');
  }
}

/** Hash verification details are restricted to auditors (Gate 4, §2.1). */
export function assertAuditViewer(role: string | undefined): void {
  if (!role || !(AUDIT_VIEWER_ROLES as readonly string[]).includes(role)) {
    throw new ForbiddenException('Audit hash details require an auditor role');
  }
}

export function assertActor(ctx: AuditActorContext): void {
  if (!ctx.id) throw new BadRequestException('Missing audit actor');
  assertAuditableRole(ctx.role);
  if (!ctx.email || !ctx.email.includes('@')) throw new BadRequestException('Invalid audit actor email');
}

/** Domain-level append-only enforcement (no UPDATE/DELETE vocabulary). */
export function assertAppendable(op: 'CREATE' | 'UPDATE' | 'DELETE'): void {
  if (op !== 'CREATE') {
    throw new ForbiddenException('CRITICAL SECURITY VIOLATION: AuditLog is append-only');
  }
}
