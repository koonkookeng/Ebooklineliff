// SSOT Phase 005 §6.1 — frontend auth-session helpers (memory + __Host cookie, no token in localStorage)
// Canonical: apps/frontend/lib/auth-session.ts (legacy src/frontend/lib/auth-session.ts)
'use client';

export const SESSION_COOKIE = '__Host-next-auth.session-token';
export const TENANT_HEADER = 'x-tenant-id';

interface SessionUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
}

// In-memory holder only (<5MB auth state budget); tokens stay in HTTP-Only cookies.
let memoryUser: SessionUser | null = null;

export function getMemoryUser(): SessionUser | null {
  return memoryUser;
}

export function setMemoryUser(user: SessionUser | null): void {
  memoryUser = user;
}

export function clearMemoryUser(): void {
  memoryUser = null;
}

export function getSessionCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const found = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return found ? decodeURIComponent(found.slice(SESSION_COOKIE.length + 1)) : null;
}

export function clearSessionCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict; Secure`;
}

export function tenantHeaders(tenantId: string): Record<string, string> {
  return { [TENANT_HEADER]: tenantId };
}

export function isAuthenticated(): boolean {
  return memoryUser !== null || getSessionCookie() !== null;
}
