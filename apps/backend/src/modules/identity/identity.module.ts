// SSOT Phase 003 §5.1 — identity bounded-context module
import { Module } from '@nestjs/common';
import { IdentityService } from './application/identity.service';
import { KYCService } from './application/kyc.service';
import { CryptoService } from './infrastructure/encryption/crypto.service';
import { UserRepository } from './infrastructure/repositories/user.repository';
import { KycController } from './presentation/controllers/kyc.controller';
import { IdentityResolver } from './presentation/resolvers/identity.resolver';

@Module({
  controllers: [KycController],
  providers: [IdentityService, KYCService, CryptoService, UserRepository, IdentityResolver],
  exports: [IdentityService, KYCService],
})
export class IdentityModule {}
