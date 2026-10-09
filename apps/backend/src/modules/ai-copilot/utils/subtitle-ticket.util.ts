// SSOT Phase 094 §8.2 — Subtitle ticket helpers (pure, zero-dep)
// Canonical: apps/backend/src/modules/ai-copilot/utils/subtitle-ticket.util.ts
// - 5-minute HMAC tickets bind a lesson download to an expiry instant.
// - Pure functions (testable without Nest).
import { createHmac, timingSafeEqual } from 'node:crypto';

export function subtitleTicket(lessonId: string, exp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${lessonId}.${exp}`).digest('hex');
}

export function verifySubtitleTicket(
  ticket: string,
  lessonId: string,
  exp: number,
  secret: string,
  now = Date.now(),
): boolean {
  if (now > exp) return false;
  const expected = subtitleTicket(lessonId, exp, secret);
  try {
    return timingSafeEqual(Buffer.from(ticket, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
