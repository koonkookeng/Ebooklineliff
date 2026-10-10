// SSOT Phase 108 §5.1 — Domain Verifier Module
// Canonical: apps/backend/src/modules/domain-verifier/domain-verifier.module.ts
// - DNS resolver integration for CNAME/SSL verification.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { DomainVerificationService } from '../tenant-orchestration/services/domain-verification.service';

@Module({
  providers: [DomainVerificationService],
  exports: [DomainVerificationService],
})
export class DomainVerifierModule {}