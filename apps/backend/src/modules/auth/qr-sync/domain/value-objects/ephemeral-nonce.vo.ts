// SSOT Phase 007 §5.1 — Ephemeral nonce value object (sealed envelope + HMAC integrity, zero-dep)
// Canonical: apps/backend/src/modules/auth/qr-sync/domain/value-objects/ephemeral-nonce.vo.ts
// Envelope proves the QR payload was minted by this backend (server-side HMAC secret);
// the LIFF client is never trusted with secrets (ADR-007).
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const NONCE_BYTES = 32;
const SECRET = () => process.env.QR_NONCE_HMAC_SECRET ?? 'qr-nonce-dev-only-change-me';

export interface QrEnvelope {
  qrToken: string;
  nonce: string;
  exp: number;
}

export function generateQrToken(): string {
  return randomUUID();
}

export function generateNonce(): string {
  return randomBytes(NONCE_BYTES).toString('hex');
}

export function hashNonce(nonce: string): string {
  return createHmac('sha256', SECRET()).update(`nonce:${nonce}`).digest('hex');
}

function b64urlEncode(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(raw: string): string {
  const pad = raw.length % 4 === 0 ? '' : '='.repeat(4 - (raw.length % 4));
  return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
}

/** Seal {qrToken, nonce, exp} into an HMAC-signed envelope string for the QR payload. */
export function sealEnvelope(input: QrEnvelope): string {
  const body = b64urlEncode(JSON.stringify(input));
  const sig = createHmac('sha256', SECRET()).update(body).digest('hex');
  return `${body}.${sig}`;
}

/** Open + verify envelope; throws on tamper/expiry/qrToken mismatch. */
export function openEnvelope(envelope: string, expectedQrToken: string): QrEnvelope {
  const parts = envelope.split('.');
  if (parts.length !== 2) throw new Error('INVALID_QR_ENVELOPE');
  const [body, sig] = parts;
  const expected = createHmac('sha256', SECRET()).update(body).digest();
  const actual = Buffer.from(sig, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('INVALID_QR_ENVELOPE');
  }
  let parsed: QrEnvelope;
  try {
    parsed = JSON.parse(b64urlDecode(body)) as QrEnvelope;
  } catch {
    throw new Error('INVALID_QR_ENVELOPE');
  }
  if (parsed.qrToken !== expectedQrToken) throw new Error('INVALID_QR_ENVELOPE');
  if (typeof parsed.exp !== 'number' || parsed.exp * 1000 < Date.now()) {
    throw new Error('QR_SESSION_EXPIRED');
  }
  return parsed;
}

/** 6-digit step-up PIN ( высок risk logins); transport only as sha256 hash. */
export function generatePin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function hashPin(pin: string): string {
  return createHmac('sha256', SECRET()).update(`pin:${pin}`).digest('hex');
}
