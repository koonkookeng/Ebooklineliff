// SSOT Phase 085 §7 — KYC domain events (stream vocabulary)
// Canonical: apps/backend/src/modules/kyc/domain/events/kyc-submitted.event.ts
export const KYC_SUBMITTED_EVENT = 'kyc.submitted';

export interface KycSubmittedEvent {
  event: typeof KYC_SUBMITTED_EVENT;
  kycId: string;
  userId: string;
  nameMatchScore: number;
  tier: 'AUTO' | 'REVIEW' | 'REJECT';
  at: number;
}
