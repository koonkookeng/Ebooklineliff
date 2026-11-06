// SSOT Phase 131 §3.1 — Hybrid web identity contracts (LINE Web OAuth / Google OIDC / Email Magic Link)
// Canonical: packages/shared/src/schemas/web-auth.schema.ts
//
// This file is additive to the Phase 005 `auth-contract.ts`. It deliberately does NOT
// modify `AuthProviderEnum` (GraphQL enum + Phase 005 clients remain byte-compatible).
// The `Account.provider` column is a free-form String, so new providers can be added
// without a database enum migration.
import { z } from 'zod';

/** Interactive browser providers that redirect through an authorization-code flow. */
export const WebAuthProviderEnum = z.enum(['LINE_WEB', 'GOOGLE']);
export type WebAuthProvider = z.infer<typeof WebAuthProviderEnum>;

/** Every identity source persisted in `Account.provider`. */
export const AccountProviderEnum = z.enum([
  'LINE_LIFF',
  'LINE_WEB',
  'GOOGLE',
  'EMAIL',
  'EMAIL_MAGIC_LINK',
]);
export type AccountProvider = z.infer<typeof AccountProviderEnum>;

const TenantIdentifierSchema = z
  .string()
  .min(1, 'Tenant is required')
  .max(128, 'Tenant identifier is too long')
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/, 'Invalid tenant identifier');

/**
 * Only same-origin absolute paths are accepted as a post-login destination.
 * Rejects protocol-relative (`//evil`), backslash tricks, control chars and
 * absolute URLs so the callback can never become an open redirect.
 */
export function sanitizeNextPath(next: unknown, fallback = '/'): string {
  if (typeof next !== 'string') return fallback;
  const value = next.trim();
  if (!value) return fallback;
  if (value.length > 512) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/\\/.test(value)) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}

export const WebAuthStartInputSchema = z.object({
  provider: WebAuthProviderEnum,
  tenant: TenantIdentifierSchema,
  redirectUri: z.string().url('redirectUri must be an absolute URL'),
  next: z.string().max(512).optional(),
});
export type WebAuthStartInput = z.infer<typeof WebAuthStartInputSchema>;

export const WebAuthCallbackInputSchema = z.object({
  provider: WebAuthProviderEnum,
  code: z.string().min(1, 'Authorization code is required').max(4096),
  state: z.string().min(16, 'Invalid OAuth state').max(512),
  redirectUri: z.string().url('redirectUri must be an absolute URL'),
});
export type WebAuthCallbackInput = z.infer<typeof WebAuthCallbackInputSchema>;

export const MagicLinkRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  tenant: TenantIdentifierSchema,
  appUrl: z.string().url('appUrl must be an absolute URL'),
  next: z.string().max(512).optional(),
});
export type MagicLinkRequest = z.infer<typeof MagicLinkRequestSchema>;

export const MagicLinkVerifySchema = z.object({
  token: z.string().min(20, 'Invalid magic link token').max(512),
});
export type MagicLinkVerify = z.infer<typeof MagicLinkVerifySchema>;

/** Server-side Redis record for an in-flight authorization-code flow. */
export const OAuthStateRecordSchema = z.object({
  provider: WebAuthProviderEnum,
  tenantId: z.string().uuid(),
  redirectUri: z.string().url(),
  codeVerifier: z.string().min(43).max(128),
  nonce: z.string().min(16).max(128),
  next: z.string().max(512),
  createdAt: z.number().int().nonnegative(),
});
export type OAuthStateRecord = z.infer<typeof OAuthStateRecordSchema>;

/** Server-side Redis record for a single-use email magic link. */
export const MagicLinkRecordSchema = z.object({
  email: z.string().email(),
  tenantId: z.string().uuid(),
  next: z.string().max(512),
  createdAt: z.number().int().nonnegative(),
});
export type MagicLinkRecord = z.infer<typeof MagicLinkRecordSchema>;

/** Normalized identity returned by every provider adapter. */
export const WebIdentitySchema = z.object({
  provider: AccountProviderEnum,
  providerAccountId: z.string().min(1),
  email: z.string().email().nullable(),
  emailVerified: z.boolean(),
  displayName: z.string().min(1).nullable(),
  avatarUrl: z.string().url().nullable(),
  nonce: z.string().nullable().optional(),
});
export type WebIdentity = z.infer<typeof WebIdentitySchema>;

export const WebAuthStartResponseSchema = z.object({
  authorizeUrl: z.string().url(),
  state: z.string().min(16),
  expiresInSec: z.number().int().positive(),
});
export type WebAuthStartResponse = z.infer<typeof WebAuthStartResponseSchema>;

export const WebAuthSessionResponseSchema = z.object({
  accessToken: z.string().min(10),
  refreshToken: z.string().uuid(),
  expiresIn: z.number().int().positive(),
  sessionId: z.string().uuid(),
  isNewUser: z.boolean(),
  next: z.string().min(1),
  user: z.object({
    id: z.string().uuid(),
    displayName: z.string().min(1),
    avatarUrl: z.string().url().nullable(),
    email: z.string().email().nullable(),
    role: z.string().min(1),
    tenantId: z.string().uuid(),
  }),
});
export type WebAuthSessionResponse = z.infer<typeof WebAuthSessionResponseSchema>;

export const EmailMagicLinkAcceptedSchema = z.object({
  ok: z.literal(true),
  // Always returned so callers cannot enumerate registered emails.
  expiresInSec: z.number().int().positive(),
});
export type EmailMagicLinkAccepted = z.infer<typeof EmailMagicLinkAcceptedSchema>;

/** PKCE helpers (RFC 7636 S256). Pure and runtime-agnostic. */
export function pkceChallengeFromVerifier(verifier: string): string {
  // Node-only: callers import this from server code, never from the browser bundle.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256')
    .update(verifier, 'ascii')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
