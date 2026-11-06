// SSOT Phase 131 §6.1 — Same-origin session cookie helpers for the auth BFF
// Canonical: apps/frontend/lib/auth-cookies.ts
//
// The backend is on a different origin (and port) than the browser in local dev,
// so only Next.js route handlers can set cookies the browser will send back to
// the app. All auth cookies are HttpOnly + Secure + SameSite=Strict and use the
// `__Host-` prefix (which itself enforces Secure/Path=/ and forbids Domain).
import type { NextRequest, NextResponse } from 'next/server';
import { sanitizeNextPath } from '@repo/shared';

export const SESSION_COOKIE = '__Host-next-auth.session-token';
export const REFRESH_COOKIE = '__Host-next-auth.refresh-token';
// Binds an in-flight OAuth flow to the browser that started it (login-CSRF guard).
// SameSite=Lax so the cookie survives the provider's top-level GET callback.
export const STATE_COOKIE = '__Host-webauth-state';

export const ACCESS_MAX_AGE_SEC = 15 * 60;
export const REFRESH_MAX_AGE_SEC = 7 * 24 * 60 * 60;
export const STATE_MAX_AGE_SEC = 10 * 60;

const BACKEND_TIMEOUT_MS = 10_000;

export function backendBaseUrl(): string {
  return (
    process.env.BACKEND_URL ??
    process.env.NEXT_PUBLIC_BACKEND_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3001'
  ).replace(/\/+$/, '');
}

function firstHeader(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first ? first : null;
}

/** Public origin as seen by the browser (ngrok/proxy aware). */
export function resolvePublicOrigin(req: NextRequest): string {
  const host =
    firstHeader(req.headers.get('x-forwarded-host')) ?? req.headers.get('host') ?? req.nextUrl.host;
  const proto =
    firstHeader(req.headers.get('x-forwarded-proto')) ?? req.nextUrl.protocol.replace(/:$/, '');
  const scheme = proto === 'https' ? 'https' : 'http';
  try {
    // `new URL` normalises and rejects injected host values before they can be
    // baked into an OAuth `redirect_uri` or a magic-link base.
    return new URL(`${scheme}://${host}`).origin;
  } catch {
    return req.nextUrl.origin;
  }
}

/**
 * Canonical app origin used to build OAuth redirect URIs.
 * `WEB_APP_URL` pins the value in production (must be registered in the
 * provider console); without it the proxy-aware request origin is used.
 */
export function publicAppOrigin(req: NextRequest): string {
  const configured = (process.env.WEB_APP_URL ?? process.env.NEXT_PUBLIC_WEB_APP_URL ?? '').trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to request origin
    }
  }
  return resolvePublicOrigin(req);
}

export function safeNextPath(next: unknown): string {
  return sanitizeNextPath(next, '/');
}

interface CookieOptions {
  httpOnly: true;
  secure: true;
  sameSite: 'strict';
  path: '/';
  maxAge: number;
}

function cookieOptions(maxAge: number): CookieOptions {
  return { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge };
}

export interface SessionCookiePayload {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
}

export function applySessionCookies(res: NextResponse, session: SessionCookiePayload): void {
  res.cookies.set(SESSION_COOKIE, session.accessToken, cookieOptions(session.expiresIn ?? ACCESS_MAX_AGE_SEC));
  res.cookies.set(REFRESH_COOKIE, session.refreshToken, cookieOptions(REFRESH_MAX_AGE_SEC));
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', cookieOptions(0));
  res.cookies.set(REFRESH_COOKIE, '', cookieOptions(0));
}

function stateCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge };
}

export function applyStateCookie(res: NextResponse, state: string): void {
  res.cookies.set(STATE_COOKIE, state, stateCookieOptions(STATE_MAX_AGE_SEC));
}

export function clearStateCookie(res: NextResponse): void {
  res.cookies.set(STATE_COOKIE, '', stateCookieOptions(0));
}

/** Forwards client metadata so backend rate limiting and audit logs see the real IP. */
export function forwardedHeaders(req: NextRequest): Record<string, string> {
  const ip =
    firstHeader(req.headers.get('x-forwarded-for')) ??
    firstHeader(req.headers.get('x-real-ip')) ??
    '';
  return {
    'Content-Type': 'application/json',
    'User-Agent': req.headers.get('user-agent') ?? 'web-auth-bff',
    ...(ip ? { 'X-Forwarded-For': ip } : {}),
    ...(req.headers.get('x-forwarded-proto')
      ? { 'X-Forwarded-Proto': firstHeader(req.headers.get('x-forwarded-proto')) ?? 'https' }
      : {}),
  };
}

export async function postToBackend(
  req: NextRequest,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${backendBaseUrl()}/api/v1${path}`, {
    method: 'POST',
    headers: forwardedHeaders(req),
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  });
}

export async function getFromBackend(
  req: NextRequest,
  path: string,
  accessToken: string,
): Promise<Response> {
  return fetch(`${backendBaseUrl()}/api/v1${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  });
}
