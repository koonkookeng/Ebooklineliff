// SSOT Phase 042 §5.1 — WatermarkModule (forensic watermarking wiring)
// Canonical: apps/backend/src/modules/watermark/watermark.module.ts
// (legacy src/backend/modules/watermark/watermark.module.ts)
// - useFactory wiring keeps application services tsx-importable.
// - PrismaService arrives via global InfraModule (single pool); the HMAC
//   secret reads WATERMARK_HMAC_SECRET (dev fallback documented in ADR-042).
// - NOTE: stray scaffold trees under ./backend/** and ./workers/** are
//   out-of-scope artifacts and are intentionally NOT registered here.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { GetWatermarkSeedHandler } from './application/queries/get-watermark-seed.handler';
import { ForensicExtractorService } from './application/services/forensic-extractor.service';
import { WatermarkCryptoService } from './application/services/watermark-crypto.service';
import { WatermarkResolver } from './infrastructure/graphql/watermark.resolver';
import { WatermarkController } from './infrastructure/rest/watermark.controller';
import { WatermarkSeedRepository, type WatermarkSeedTables } from './infrastructure/repositories/watermark-seed.repository';

@Module({
  controllers: [WatermarkController],
  providers: [
    {
      provide: WatermarkCryptoService,
      useFactory: (): WatermarkCryptoService =>
        new WatermarkCryptoService(process.env.WATERMARK_HMAC_SECRET || process.env.APP_SECRET || 'AHONG_EMERALD_SECRET_KEY_999'),
    },
    {
      provide: WatermarkSeedRepository,
      useFactory: (prisma: PrismaService): WatermarkSeedRepository =>
        new WatermarkSeedRepository(prisma as unknown as WatermarkSeedTables),
      inject: [PrismaService],
    },
    {
      provide: GetWatermarkSeedHandler,
      useFactory: (crypto: WatermarkCryptoService, repo: WatermarkSeedRepository): GetWatermarkSeedHandler =>
        new GetWatermarkSeedHandler(crypto, repo),
      inject: [WatermarkCryptoService, WatermarkSeedRepository],
    },
    {
      provide: ForensicExtractorService,
      useFactory: (crypto: WatermarkCryptoService, repo: WatermarkSeedRepository): ForensicExtractorService =>
        new ForensicExtractorService(crypto, repo),
      inject: [WatermarkCryptoService, WatermarkSeedRepository],
    },
    WatermarkResolver,
  ],
  exports: [WatermarkCryptoService, WatermarkSeedRepository, GetWatermarkSeedHandler, ForensicExtractorService],
})
export class WatermarkModule {}
