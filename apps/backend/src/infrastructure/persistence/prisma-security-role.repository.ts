// SSOT Phase 106 Task 1/5 — PrismaSecurityRoleRepository (atomic $transaction, Gate 7)
// Canonical: apps/backend/src/infrastructure/persistence/prisma-security-role.repository.ts
// - updateMatrix runs role upsert + scope replace + audit append in ONE transaction.
// - evaluate inputs are read-only (no N+1: single role + scopes fetch).
// - Prisma client is structural (port) so unit tests inject fakes; zero new deps.
import { Injectable } from '@nestjs/common';

export interface SecurityRoleRow {
  id: string;
  tenantId: string;
  name: string;
  bitwiseMask: string | number;
  updatedAt?: Date;
}

export interface RoleMatrix {
  roleId: string;
  roleName: string;
  tenantId: string;
  permissionBitmask: string;
  grantedScopes: string[];
  updatedAt: string;
}

interface PrismaPort {
  securityRole: {
    findUnique(args: unknown): Promise<(SecurityRoleRow & { scopes?: Array<{ scopePattern: string }> }) | null>;
    upsert(args: unknown): Promise<SecurityRoleRow>;
  };
  roleScopeRegistry: {
    deleteMany(args: unknown): Promise<unknown>;
    createMany(args: unknown): Promise<unknown>;
  };
  securityAuditLog: {
    create(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: PrismaPort) => Promise<T>): Promise<T>;
}

@Injectable()
export class PrismaSecurityRoleRepository {
  constructor(private readonly prisma: PrismaPort) {}

  async getMatrix(tenantId: string, roleId: string): Promise<RoleMatrix | null> {
    const row = await this.prisma.securityRole.findUnique({
      where: { id: roleId },
      include: { scopes: true },
    });
    if (!row || (row as SecurityRoleRow).tenantId !== tenantId) return null;
    const scopes = ((row as unknown as { scopes?: Array<{ scopePattern: string }> }).scopes ?? []).map(
      (s) => s.scopePattern,
    );
    return {
      roleId: row.id,
      roleName: row.name,
      tenantId: row.tenantId,
      permissionBitmask: String(row.bitwiseMask),
      grantedScopes: scopes,
      updatedAt: (row.updatedAt ?? new Date()).toISOString(),
    };
  }

  async updateMatrix(input: {
    tenantId: string;
    roleId: string;
    roleName: string;
    bitmask: string;
    scopes: string[];
    actorUserId: string;
    ipAddress: string;
    userAgent: string;
  }): Promise<RoleMatrix> {
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.securityRole.upsert({
        where: { id: input.roleId },
        create: {
          id: input.roleId,
          tenantId: input.tenantId,
          name: input.roleName,
          bitwiseMask: input.bitmask,
        },
        update: { bitwiseMask: input.bitmask },
      });
      await tx.roleScopeRegistry.deleteMany({ where: { roleId: role.id } });
      if (input.scopes.length > 0) {
        await tx.roleScopeRegistry.createMany({
          data: input.scopes.map((scopePattern) => ({ roleId: role.id, scopePattern })),
        });
      }
      await tx.securityAuditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.actorUserId,
          action: 'ROLE_MATRIX_UPDATE',
          requiredScope: null,
          providedScopes: input.scopes,
          granted: true,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });
      return {
        roleId: role.id,
        roleName: role.name,
        tenantId: input.tenantId,
        permissionBitmask: String(input.bitmask),
        grantedScopes: [...input.scopes],
        updatedAt: new Date().toISOString(),
      };
    });
  }

  async appendAudit(input: {
    tenantId?: string;
    userId?: string;
    action: string;
    requiredScope?: string;
    providedScopes: string[];
    granted: boolean;
    ipAddress: string;
    userAgent: string;
  }): Promise<void> {
    await this.prisma.securityAuditLog.create({ data: { ...input } });
  }
}
