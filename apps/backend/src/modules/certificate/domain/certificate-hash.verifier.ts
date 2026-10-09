// SSOT Phase 105 §8.2 — Public hash verifier (delegates 048 crypto single-source)
// Canonical: apps/backend/src/modules/certificate/domain/certificate-hash.verifier.ts
// - RISK_CALL: HMAC truth is 048 `digitalSignatureHash`
//   (payload certNo:userId:courseId:displayName). This file MUST NOT invent a
//   parallel payload — it only wraps DigitalSignature timing-safe verify.
// - Pure + tsx-safe. Zero new deps (node:crypto via VO).
import { DigitalSignature, buildHmacPayload } from './value-objects/digital-signature.vo';

export { DigitalSignature, buildHmacPayload };

/** Timing-safe public verification against the stored issuance signature. */
export function verifyPublicHash(args: {
  certificateNo: string;
  userId: string;
  courseId: string;
  displayName: string;
  storedSignature: string;
  providedHash?: string;
  secret?: string;
}): boolean {
  const secret = args.secret ?? process.env.CERTIFICATE_HMAC_SECRET ?? 'AHONG_EMERALD_SECRET_KEY_999';
  const payload = buildHmacPayload(args.certificateNo, args.userId, args.courseId, args.displayName);
  if (!DigitalSignature.verify(payload, secret, args.storedSignature)) {
    return false;
  }
  // Optional QR-bound hash must match the stored issuance signature.
  if (args.providedHash != null && args.providedHash !== args.storedSignature) return false;
  return true;
}
