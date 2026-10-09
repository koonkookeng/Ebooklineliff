// SSOT Phase 085 §7 — KYC domain events (stream vocabulary)
// Canonical: apps/backend/src/modules/kyc/domain/events/kyc-approved.event.ts
export const KYC_DECIDED_EVENT = 'kyc.decided';

export interface KycDecidedEvent {
  event: typeof KYC_DECIDED_EVENT;
  kycId: string;
  userId: string;
  status: 'VERIFIED' | 'REJECTED' | 'ACTION_REQUIRED';
  actorUserId: string;
  at: number;
}
