// SSOT Phase 021 — LINE LIFF Auth Zod SSOT Contract
// Canonical: packages/shared/src/schemas/liff-auth.schema.ts
// (legacy src/shared/schemas/liff-auth.schema.ts)
import { z } from 'zod';

export const LiffEnvironmentEnum = z.enum([
  'LINE_IN_APP',
  'LINE_MINI_APP_SUBWINDOW',
  'EXTERNAL_BROWSER',
  'DESKTOP_MOCK',
]);

export const LiffInitPayloadSchema = z.object({
  liffId: z.string().min(1, 'LIFF ID is required'),
  tenantId: z.string().min(1, 'Tenant ID is required'),
  environment: LiffEnvironmentEnum,
  isLoggedIn: z.boolean(),
  appLanguage: z.string().optional(),
  os: z.enum(['ios', 'android', 'web']).optional(),
  lineVersion: z.string().optional(),
});

export const LiffAuthHandshakeSchema = z.object({
  idToken: z.string().min(1, 'LINE ID Token is required'),
  accessToken: z.string().optional(),
  tenantId: z.string().min(1, 'Tenant ID is required'),
  referralCode: z.string().optional(),
});

export const LiffAuthResponseSchema = z.object({
  success: z.boolean(),
  accessToken: z.string(),
  user: z.object({
    id: z.string().uuid(),
    lineUserId: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    role: z.string(),
    tenantId: z.string(),
  }),
  expiresIn: z.number(),
});

export type LiffInitPayload = z.infer<typeof LiffInitPayloadSchema>;
export type LiffAuthHandshake = z.infer<typeof LiffAuthHandshakeSchema>;
export type LiffAuthResponse = z.infer<typeof LiffAuthResponseSchema>;
export type LiffEnvironment = z.infer<typeof LiffEnvironmentEnum>;