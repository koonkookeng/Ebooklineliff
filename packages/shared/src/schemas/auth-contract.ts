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
  // Phase 006 enrichment (optional => Phase 005 clients unaffected)
  tenantId: z.string().uuid().optional(),
  walletBalance: z.number().nonnegative().optional(),
  rewardPoints: z.number().int().nonnegative().optional(),
  affiliateCode: z.string().optional(),
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

// ---- Phase 006 §3.1: LIFF seamless-auth domain (additive; Phase 005 names unchanged) ----

// NOTE: UserRoleEnum is owned by ./identity.zod (Phase 003 SSOT) — re-exported here under the
// Phase 006 §3.1 vocabulary (zero-redundant policy, single source of truth).
import { UserRoleEnum } from './identity.zod';
export { UserRoleEnum };
export type UserRole = z.infer<typeof UserRoleEnum>;

export const DeviceInfoSchema = z.object({
  os: z.string().max(64).optional(),
  browser: z.string().max(64).optional(),
  ipAddress: z.string().ip().optional(),
});
export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;

export const LiffAuthInputSchema = z.object({
  idToken: z.string().min(10, 'LINE ID Token is required'),
  tenantId: z.string().uuid('Invalid Tenant ID format'),
  referralCode: z.string().min(1).max(64).optional(),
  deviceInfo: DeviceInfoSchema.optional(),
});
export type LiffAuthInput = z.infer<typeof LiffAuthInputSchema>;

export const DecodedLineTokenSchema = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1, 'LINE User ID (sub) is missing'),
  aud: z.string().min(1),
  exp: z.number().int(),
  iat: z.number().int(),
  nonce: z.string().optional(),
  name: z.string().optional(),
  picture: z.string().url().optional(),
  email: z.string().email().optional(),
});
export type DecodedLineToken = z.infer<typeof DecodedLineTokenSchema>;

export const UserProfileAuthSchema = z.object({
  id: z.string().uuid(),
  lineUserId: z.string().min(1),
  displayName: z.string().min(1),
  avatarUrl: z.string().nullable(),
  email: z.string().nullable(),
  role: UserRoleEnum,
  tenantId: z.string().uuid(),
  walletBalance: z.number().nonnegative(),
  rewardPoints: z.number().int().nonnegative(),
  affiliateCode: z.string().min(1),
  createdAt: z.string().min(1),
});
export type UserProfileAuth = z.infer<typeof UserProfileAuthSchema>;

export const AuthTokenResponseSchema = z.object({
  accessToken: z.string().min(10),
  expiresIn: z.number().int().positive(),
  user: UserProfileAuthSchema,
});
export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>;

// ---- Phase 007 §3.1: QR cross-platform login sync (additive) ----

export const QrSessionStatusEnum = z.enum(['PENDING', 'SCANNED', 'AUTHORIZED', 'EXPIRED', 'REJECTED']);
export type QrSessionStatus = z.infer<typeof QrSessionStatusEnum>;

export const InitQrSessionResponseSchema = z.object({
  qrToken: z.string().uuid(),
  encryptedNonce: z.string().min(10),
  expiresInSec: z.number().int().positive().default(60),
  websocketChannel: z.string().min(1),
});
export type InitQrSessionResponse = z.infer<typeof InitQrSessionResponseSchema>;

export const ConfirmQrAuthPayloadSchema = z.object({
  qrToken: z.string().uuid(),
  userAccessToken: z.string().min(10),
  deviceFingerprint: z.string().min(1).max(128),
  userAgent: z.string().max(500),
  ipAddress: z.string().ip(),
  envelope: z.string().min(10).optional(),
  pin: z.string().regex(/^\d{6}$/).optional(),
});
export type ConfirmQrAuthPayload = z.infer<typeof ConfirmQrAuthPayloadSchema>;

export const QrAuthSocketBroadcastSchema = z.object({
  status: QrSessionStatusEnum,
  authToken: z.string().optional(),
  refreshToken: z.string().optional(),
  oneTimeCode: z.string().optional(),
  requirePin: z.boolean().optional(),
  // Step-up PIN displayed ONLY on the desktop channel (never returned to LIFF)
  pinDisplay: z.string().regex(/^\d{6}$/).optional(),
  userProfile: z
    .object({
      id: z.string().uuid(),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
      role: z.string(),
    })
    .optional(),
  errorMessage: z.string().optional(),
});
export type QrAuthSocketBroadcast = z.infer<typeof QrAuthSocketBroadcastSchema>;
