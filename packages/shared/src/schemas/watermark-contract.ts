// SSOT Phase 042 Task 1 — Watermark Zod contract
// Canonical: packages/shared/src/schemas/watermark-contract.ts
// (legacy src/shared/schemas/watermark-contract.ts)
// - Spec-verbatim: WatermarkMotionModeEnum / WatermarkSeedPayloadSchema /
//   ForensicVerificationPayloadSchema (§3.1 Gate 1).
// - Additive (zero-dep): seed TTL (15min refresh, §2.2), stego geometry
//   (16x16 bottom-right, BDD), opacity bands (§2.1), Lissajous helper,
//   tamper event names (§7.1).
import { z } from 'zod';

export const WatermarkMotionModeEnum = z.enum([
  'LISSAJOUS_CURVE',
  'RANDOM_BOUNCE',
  'LINEAR_DIAGONAL',
  'STATIC_GRID_PULSE',
]);
export type WatermarkMotionMode = z.infer<typeof WatermarkMotionModeEnum>;

export const WatermarkSeedPayloadSchema = z.object({
  seedId: z.string().uuid(),
  userIdHash: z.string().length(64),
  lineUserId: z.string().optional(),
  displayName: z.string().min(1),
  clientIp: z.string().min(1),
  timestamp: z.string().datetime(),
  hmacSignature: z.string().min(1),
  config: z.object({
    opacityMin: z.number().min(0.05).max(0.3),
    opacityMax: z.number().min(0.2).max(0.6),
    fontSizePx: z.number().int().min(10).max(24),
    motionMode: WatermarkMotionModeEnum,
    steganographyEnabled: z.boolean().default(true),
  }),
});
export type WatermarkSeedPayload = z.infer<typeof WatermarkSeedPayloadSchema>;

export const ForensicVerificationPayloadSchema = z.object({
  extractedUserIdHash: z.string(),
  extractedLineUserId: z.string().nullable(),
  extractedTimestamp: z.string(),
  confidenceScore: z.number().min(0).max(100),
  isTampered: z.boolean(),
});
export type ForensicVerificationPayload = z.infer<typeof ForensicVerificationPayloadSchema>;

/** §2.2 seed refresh cadence (background, never blocks reading). */
export const WATERMARK_SEED_TTL_SEC = 900;
/** BDD: stego block geometry (bottom-right RGBA alpha-channel). */
export const WATERMARK_STEGO_SIZE_PX = 16;
/** §2.1 opacity oscillation band (recomputed every 3s). */
export const WATERMARK_OPACITY_MIN = 0.12;
export const WATERMARK_OPACITY_MAX = 0.25;
/** §2.2 idle throttle: 60fps active → 10fps after 5s still. */
export const WATERMARK_IDLE_AFTER_MS = 5000;
export const WATERMARK_ACTIVE_FPS = 60;
export const WATERMARK_IDLE_FPS = 10;
/** §7.1 Redis Stream key for security/watermark events. */
export const WATERMARK_EVENT_STREAM = 'stream:security:watermark-events';
/** §7.1 tamper violation vocabulary (BDD-2). */
export const WatermarkViolationTypeEnum = z.enum(['TAMPER_DOM', 'SCREENSHOT_DETECTED', 'DEVTOOLS_OPENED']);
export type WatermarkViolationType = z.infer<typeof WatermarkViolationTypeEnum>;

/** §2.1 Lissajous position (x=A·sin(at+δ), y=B·sin(bt)), normalized 0..1. */
export function lissajousPosition(
  tSec: number,
  a = 0.5,
  b = 0.3,
  amplitude = 0.35,
): { nx: number; ny: number } {
  return {
    nx: Math.sin(a * tSec) * amplitude + 0.5,
    ny: Math.cos(b * tSec) * amplitude + 0.5,
  };
}

/** HMAC manifest covered by the seed signature (crypto service parity). */
export function watermarkHmacMessage(seedId: string, userIdHash: string, timestamp: string): string {
  return `${seedId}:${userIdHash}:${timestamp}`;
}
