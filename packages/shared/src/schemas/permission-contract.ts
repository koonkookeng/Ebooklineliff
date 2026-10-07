// SSOT Phase 032 §3.1 — Device permission + geocoding Zod SSOT contract
// Canonical: packages/shared/src/schemas/permission-contract.ts
// (legacy src/shared/schemas/permission-contract.ts)
// - Spec-verbatim: PermissionTypeEnum / PermissionStatusEnum /
//   PermissionRequestPayloadSchema / GeolocationCoordinatesSchema /
//   ReverseGeocodeResultSchema / PermissionAuditLogSchema.
// - RISK_CALL deviations (documented, additive-only):
//   - tenantId/userId are z.string().min(1), not uuid: edge identity vocabulary
//     (Phase 023–031 precedent); uuid strictness 400s valid LIFF sessions.
//   - devicePlatform accepts the 4 spec values (no others — prompt injection
//     into analytics is rejected, Gate 4).
// - PDPA sheet copy lives here (single source for PrePermissionSheet, §2.1).
// - Zero new deps (zod only).
import { z } from 'zod';

export const PermissionTypeEnum = z.enum(['CAMERA', 'PHOTO_LIBRARY', 'GEOLOCATION', 'MICROPHONE']);
export type PermissionType = z.infer<typeof PermissionTypeEnum>;

export const PermissionStatusEnum = z.enum(['PROMPT', 'GRANTED', 'DENIED', 'RESTRICTED', 'UNSUPPORTED']);
export type PermissionStatus = z.infer<typeof PermissionStatusEnum>;

export const DevicePlatformEnum = z.enum(['IOS', 'ANDROID', 'DESKTOP_WEB', 'LINE_LIFF']);
export type DevicePlatform = z.infer<typeof DevicePlatformEnum>;

export const PermissionRequestPayloadSchema = z.object({
  tenantId: z.string().min(1),
  permissionType: PermissionTypeEnum,
  purpose: z.string().min(5).max(200),
  devicePlatform: DevicePlatformEnum,
});
export type PermissionRequestPayload = z.infer<typeof PermissionRequestPayloadSchema>;

export const GeolocationCoordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().default(0),
});
export type GeolocationCoordinates = z.infer<typeof GeolocationCoordinatesSchema>;

export const ReverseGeocodeResultSchema = z.object({
  subdistrict: z.string().min(1),
  district: z.string().min(1),
  province: z.string().min(1),
  postalCode: z.string().min(1),
  formattedAddress: z.string().min(1),
});
export type ReverseGeocodeResult = z.infer<typeof ReverseGeocodeResultSchema>;

export const PermissionAuditLogSchema = z.object({
  userId: z.string().min(1),
  permissionType: PermissionTypeEnum,
  status: PermissionStatusEnum,
  purpose: z.string().min(1).max(200).default('unspecified'),
  devicePlatform: DevicePlatformEnum.default('LINE_LIFF'),
  ipAddress: z.string().min(1).default('unknown'),
  userAgent: z.string().max(500).default('Unknown'),
  requestedAt: z.string().datetime(),
});
export type PermissionAuditLog = z.infer<typeof PermissionAuditLogSchema>;

/** Geolocation request budget: 10s timeout, low power (BDD Scenario 2). */
export const GEOLOCATION_TIMEOUT_MS = 10000;
/** Reverse-geocode edge cache TTL: 30 days (grid-rounded keys, Gate 6). */
export const GEOCODE_CACHE_TTL_SEC = 86400 * 30;
/** Permission analytics channel (Gate 8: prompt/accepted/denied funnel). */
export const PERMISSION_ANALYTICS_CHANNEL = 'permission.events';
/** Redis key for a rounded geocode cell. */
export function geocodeCacheKey(lat: number, lng: number): string {
  return `geo:reverse:${lat.toFixed(3)}:${lng.toFixed(3)}`;
}

/** Detect the device platform vocabulary from a user-agent string. */
export function detectDevicePlatform(userAgent: string, inLineClient = false): DevicePlatform {
  if (inLineClient || / Line\//i.test(userAgent)) return 'LINE_LIFF';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'IOS';
  if (/Android/i.test(userAgent)) return 'ANDROID';
  return 'DESKTOP_WEB';
}

export interface PermissionSheetCopy {
  title: string;
  description: string;
  benefit: string;
}

/** PDPA educational copy per permission type (§2.1/Task 4, Thai). */
export const PERMISSION_SHEET_COPY: Record<PermissionType, PermissionSheetCopy> = {
  CAMERA: {
    title: 'ขอสิทธิ์ใช้งานกล้องถ่ายภาพ',
    description: 'เพื่อถ่ายภาพสลิปการโอนเงิน หรือสแกน QR Code เพื่อรับสิทธิ์เข้าถึงเนื้อหาโดยทันที',
    benefit: 'ระบบตรวจสอบสลิปอัตโนมัติภายใน 1 วินาที ไม่ต้องรอแอดมินอนุมัติ',
  },
  PHOTO_LIBRARY: {
    title: 'ขอสิทธิ์เข้าถึงคลังรูปภาพ',
    description: 'เพื่อเลือกรูปภาพสลิปการโอนเงินจากอัลบั้มของคุณในการยืนยันชำระเงิน',
    benefit: 'ภาพของคุณจะถูกใช้วิเคราะห์เฉพาะสลิปโอนเงินอย่างปลอดภัยตามมาตรฐาน PDPA',
  },
  GEOLOCATION: {
    title: 'ขอสิทธิ์เข้าถึงตำแหน่ง (GPS)',
    description: 'เพื่อเติมข้อมูลที่อยู่จัดส่งพัสดุหนังสือเล่มจริงอัตโนมัติอย่างถูกต้องแม่นยำ',
    benefit: 'ประหยัดเวลาไม่ต้องพิมพ์ที่อยู่เอง ป้องกันพัสดุจัดส่งผิดพลาด',
  },
  MICROPHONE: {
    title: 'ขอสิทธิ์ใช้งานไมโครโฟน',
    description: 'เพื่อใช้งานระบบโต้ตอบเสียงในคอร์สเรียนออนไลน์',
    benefit: 'เข้าร่วมการสอนสดได้อย่างสมบูรณ์แบบ',
  },
};

/** Guided settings paths for the DENIED fallback (BDD Scenario 3, Task 5). */
export const SETTINGS_PATH_COPY: Record<DevicePlatform, string> = {
  LINE_LIFF: 'LINE > ตั้งค่า > ความเป็นส่วนตัว > จัดการสิทธิ์แอป',
  IOS: 'การตั้งค่า > ความเป็นส่วนตัวและความปลอดภัย > กล้อง/ตำแหน่งที่ตั้ง',
  ANDROID: 'การตั้งค่า > แอป > LINE > สิทธิ์',
  DESKTOP_WEB: 'ไอคอนกุญแจหน้า URL > การตั้งค่าเว็บไซต์ > กล้อง/ตำแหน่ง',
};
