// SSOT Phase 022 §3.1 — Environment Detection & Safe-Area Zod SSOT Contract
// Canonical: packages/shared/src/schemas/environment-contract.ts
// (legacy src/shared/schemas/environment-contract.ts)
import { z } from 'zod';

export const EnvironmentTypeEnum = z.enum([
  'LINE_LIFF_IOS',
  'LINE_LIFF_ANDROID',
  'STANDALONE_PWA',
  'MOBILE_SAFARI',
  'MOBILE_CHROME',
  'IN_APP_WEBVIEW',
  'DESKTOP_BROWSER',
]);

export const SafeAreaInsetsSchema = z.object({
  top: z.number().min(0),
  bottom: z.number().min(0),
  left: z.number().min(0),
  right: z.number().min(0),
});

export const ViewportMetricsSchema = z.object({
  windowWidth: z.number().positive(),
  windowHeight: z.number().positive(),
  devicePixelRatio: z.number().positive(),
  isTouchDevice: z.boolean(),
  safeArea: SafeAreaInsetsSchema,
  environment: EnvironmentTypeEnum,
});

export const SyncEnvironmentPayloadSchema = z.object({
  userId: z.string().uuid().optional(),
  tenantId: z.string(),
  metrics: ViewportMetricsSchema,
  userAgent: z.string(),
  timestamp: z.string().datetime(),
});

export type EnvironmentType = z.infer<typeof EnvironmentTypeEnum>;
export type SafeAreaInsets = z.infer<typeof SafeAreaInsetsSchema>;
export type ViewportMetrics = z.infer<typeof ViewportMetricsSchema>;
export type SyncEnvironmentPayload = z.infer<typeof SyncEnvironmentPayloadSchema>;

/** Layout modes returned by the analytics service (§5.1). */
export const LayoutModeEnum = z.enum(['STANDARD_WEB', 'LIFF_EMBEDDED_COMPACT', 'WEBVIEW_FULLSCREEN_SAFE']);
export type LayoutMode = z.infer<typeof LayoutModeEnum>;
