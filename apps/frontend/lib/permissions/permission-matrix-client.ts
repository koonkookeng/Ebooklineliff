// SSOT Phase 106 §6.1 — permission-matrix edge client (zero-dep, LIFF memory-safe)
// Canonical: apps/frontend/lib/permissions/permission-matrix-client.ts
// - Matrix fetch/update via v1 proxies (JWT cookie binds identity; no token in LS).
// - Pure BigInt toggle helpers live here so builder + hook share one source.
// - Zero new deps.
import { BitwisePermissionFlags } from '@repo/shared';

export interface RoleMatrixDto {
  roleId: string;
  roleName: string;
  tenantId: string;
  permissionBitmask: string;
  grantedScopes: string[];
  updatedAt: string;
}

export function toggleBitmask(current: string, flag: bigint): string {
  const cur = BigInt(current || '0');
  const next = (cur & flag) === flag ? cur & ~flag : cur | flag;
  return next.toString();
}

export function isBitSet(current: string, flag: bigint): boolean {
  const cur = BigInt(current || '0');
  return (cur & flag) === flag;
}

export async function fetchRoleMatrix(tenantId: string, roleId: string): Promise<RoleMatrixDto | null> {
  try {
    const res = await fetch(
      `/api/v1/security/roles/${encodeURIComponent(roleId)}?tenantId=${encodeURIComponent(tenantId)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: RoleMatrixDto };
    return json.data ?? null;
  } catch {
    return null;
  }
}

export async function persistRoleMatrix(input: {
  tenantId: string;
  roleId: string;
  roleName?: string;
  bitmask: string;
  scopes: string[];
}): Promise<boolean> {
  try {
    const res = await fetch(`/api/v1/security/roles/${encodeURIComponent(input.roleId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: input.tenantId,
        roleName: input.roleName ?? input.roleId,
        permissionBitmask: input.bitmask,
        scopes: input.scopes,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export { BitwisePermissionFlags };
