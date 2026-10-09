// SSOT Phase 084 §3.1 — Abandoned cart recovery contract
// Canonical: packages/shared/src/schemas/abandoned-cart.schema.ts
// (legacy src/shared/schemas/abandoned-cart.schema.ts — did not exist)
// - Spec-verbatim: AbandonedCartTriggerPayloadSchema /
//   RecoveryCheckoutPayloadSchema (§3.1) + MessagingChannelEnum.
// - RISK_CALL deviations (additive-only, documented, SSOT-union driven):
//   (a) AbandonedCartStatusEnum omits CHECKOUT_STARTED — the Prisma
//       AbandonedStatus union (011 + schema.md) has ACTIVE/ABANDONED/
//       RECOVERED/EXPIRED only; the contract follows the union;
//   (b) NotificationStepEnum has the schema.md-canonical 2 steps
//       (STEP_1_15_MIN, STEP_2_3_HOURS), not the phase text's 3rd step;
//   (c) tenantId is z.string().min(1) (071/073 vocabulary);
//   (d) coupon truth lives on AbandonedCartLog + BehavioralCampaign — no
//       parallel coupon table (088/117 own coupon design).
// - Pure helpers: idle/step due math (15min/3h), recovery coupon code +
//   HMAC magic-link sign/verify (2h TTL), discount math, Flex countdown,
//   stream keys. Zero new deps (zod only; node:crypto via require).
import { z } from 'zod';

export const AbandonedCartStatusEnum = z.enum(['ACTIVE', 'ABANDONED', 'RECOVERED', 'EXPIRED']);
export type AbandonedCartStatus = z.infer<typeof AbandonedCartStatusEnum>;

export const NotificationStepEnum = z.enum(['STEP_1_15_MIN', 'STEP_2_3_HOURS']);
export type NotificationStep = z.infer<typeof NotificationStepEnum>;

export const MessagingChannelEnum = z.enum(['LINE_FLEX', 'LINE_TEXT', 'WEB_PUSH', 'SMS']);
export type MessagingChannel = z.infer<typeof MessagingChannelEnum>;

export const AbandonedCartTriggerPayloadSchema = z.object({
  tenantId: z.string().min(1),
  cartId: z.string().uuid(),
  userId: z.string().uuid(),
  lineUserId: z.string().nullable(),
  cartItems: z.array(z.object({
    productId: z.string().uuid(),
    productTitle: z.string(),
    coverImageUrl: z.string().url(),
    price: z.number().positive(),
    quantity: z.number().int().positive(),
  })),
  totalAmount: z.number().positive(),
  lastActivityAt: z.string().datetime(),
});
export type AbandonedCartTriggerPayload = z.infer<typeof AbandonedCartTriggerPayloadSchema>;

export const RecoveryCheckoutPayloadSchema = z.object({
  recoveryToken: z.string(),
  cartId: z.string().uuid(),
  couponCode: z.string().optional(),
  isExpired: z.boolean(),
});
export type RecoveryCheckoutPayload = z.infer<typeof RecoveryCheckoutPayloadSchema>;

/** Step-1 nudge at 15 idle minutes (BDD-1). */
export const ABANDON_STEP1_IDLE_MIN = 15;
/** Step-2 incentive at 3 idle hours (BDD-1). */
export const ABANDON_STEP2_IDLE_MIN = 180;
/** Recovery coupon window: 2 hours (§5.2). */
export const RECOVERY_COUPON_TTL_SEC = 2 * 60 * 60;
/** Magic-link session TTL: 2 hours (matches the coupon). */
export const RECOVERY_TOKEN_TTL_SEC = 2 * 60 * 60;
/** Step discounts: 10% nudge / 15% incentive (§5.2). */
export const RECOVERY_STEP1_PCT = 10;
export const RECOVERY_STEP2_PCT = 15;
/** Anti-spam: max 2 recovery messages per abandonment (§8.1). */
export const RECOVERY_MAX_MESSAGES = 2;
/** Cart recovery stream (Gate 8). */
export const CART_RECOVERY_STREAM = 'stream:cart:recovery';

function nodeCrypto(): {
  createHmac(a: string, s: string): { update(d: string): { digest(e: string): string } };
  timingSafeEqual(a: Buffer, b: Buffer): boolean;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto') as never;
}

/** True when a cart idle since lastActivityAt is due for the step. */
export function isStepDue(lastActivityAt: number, step: 'STEP_1_15_MIN' | 'STEP_2_3_HOURS', now = Date.now()): boolean {
  const idleMin = (now - lastActivityAt) / 60_000;
  return step === 'STEP_1_15_MIN' ? idleMin >= ABANDON_STEP1_IDLE_MIN : idleMin >= ABANDON_STEP2_IDLE_MIN;
}

/** Recovery coupon code: RECOVER-XXXXX (uppercase base36). */
export function recoveryCouponCode(rand = Math.floor(Math.random() * 36 ** 5)): string {
  return `RECOVER-${rand.toString(36).toUpperCase().padStart(5, '0')}`;
}

/** Percent-off discount, 2-decimal: 10% of 1000 → 100. */
export function recoveryDiscount(totalAmount: number, percent: number): number {
  return Math.round(totalAmount * (percent / 100) * 100) / 100;
}

/** Sign a magic-link token: base64url(`${cartId}:${exp}:${hmac}`). */
export function signRecoveryToken(secret: string, cartId: string, now = Date.now()): string {
  const exp = now + RECOVERY_TOKEN_TTL_SEC * 1000;
  const hmac = nodeCrypto().createHmac('sha256', secret).update(`${cartId}:${exp}`).digest('hex');
  return Buffer.from(`${cartId}:${exp}:${hmac}`).toString('base64url');
}

/** Verify a magic-link token. Returns the cartId or null. */
export function verifyRecoveryToken(secret: string, token: string, now = Date.now()): string | null {
  try {
    const crypto = nodeCrypto();
    const [cartId, expRaw, hmac] = Buffer.from(token, 'base64url').toString('utf8').split(':');
    if (!cartId || !expRaw || !hmac) return null;
    if (Number(expRaw) < now) return null;
    const expected = crypto.createHmac('sha256', secret).update(`${cartId}:${expRaw}`).digest('hex');
    const a = Buffer.from(hmac, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return cartId;
  } catch {
    return null;
  }
}

/** Magic recovery URL deep into the LIFF cart entry. */
export function recoveryUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/cart/recover?token=${encodeURIComponent(token)}`;
}

/** Seconds left on a coupon countdown (clamped at 0). */
export function couponCountdownSec(expiresAt: number, now = Date.now()): number {
  return Math.max(0, Math.floor((expiresAt - now) / 1000));
}

/** Redis due-index key for a cart abandonment watch. */
export function abandonWatchKey(cartId: string): string {
  return `cart:abandon:watch:${cartId}`;
}

/** Recovery rate 0–100 (1-decimal): recovered/abandoned. */
export function recoveryRate(recovered: number, abandoned: number): number {
  if (abandoned <= 0) return 0;
  return Math.round((recovered / abandoned) * 1000) / 10;
}
