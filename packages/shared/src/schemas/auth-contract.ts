// SSOT Phase 005 §3.1 — Unified Zod Auth Contract (LINE LIFF / Web OAuth / Google / Email+Password / Refresh)
// Canonical: packages/shared/src/schemas/auth-contract.ts (legacy src/shared/schemas/auth-contract.ts)
import { z } from 'zod';

export const AuthProviderEnum = z.enum([
  'LINE_LIFF',
  'LINE_WEB',
  'GOOGLE',
  'EMAIL_PASSWORD',
  'REFRESH_TOKEN',
]);
export type AuthProvider = z.infer<typeof AuthProviderEnum>;

export const LineLiffAuthInputSchema = z.object({
  idToken: z.string().min(10, 'Invalid LIFF ID Token'),
  tenantId: z.string().uuid(),
  referralCode: z.string().min(1).max(64).optional(),
});
export type LineLiffAuthInput = z.infer<typeof LineLiffAuthInputSchema>;

// Backward-compat alias for Phase 004 resolver (accessToken == idToken single-field form)
export const AuthenticateLineLiffInputSchema = z
  .object({
    accessToken: z.string().min(10).optional(),
    idToken: z.string().min(10).optional(),
    tenantId: z.string().uuid(),
    referralCode: z.string().min(1).max(64).optional(),
  })
  .refine((v) => v.accessToken ?? v.idToken, { message: 'Invalid LINE authentication input' });
export type AuthenticateLineLiffInput = z.infer<typeof AuthenticateLineLiffInputSchema>;

export const WebOAuthInputSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  redirectUri: z.string().url(),
  tenantId: z.string().uuid(),
});
export type WebOAuthInput = z.infer<typeof WebOAuthInputSchema>;

export const JwtPayloadSchema = z.object({
  sub: z.string().uuid(), // User UUID
  lineUserId: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  role: z.enum([
    'SUPER_ADMIN',
    'FINANCE_ADMIN',
    'CONTENT_MODERATOR',
    'SUPPORT_STAFF',
    'INSTRUCTOR',
    'SELLER',
    'MEMBER',
  ]),
  tenantId: z.string().uuid(),
  sessionId: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type JwtPayload = z.infer<typeof JwtPayloadSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1),
  avatarUrl: z.string().nullable(),
  email: z.string().nullable(),
  lineUserId: z.string().nullable(),
  role: z.string().min(1),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthResponseSchema = z.object({
  accessToken: z.string().min(10),
  expiresIn: z.number().int().positive(),
  user: AuthUserSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const RefreshRotationInputSchema = z.object({
  refreshToken: z.string().uuid(),
});
export type RefreshRotationInput = z.infer<typeof RefreshRotationInputSchema>;
