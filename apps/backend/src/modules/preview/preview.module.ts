// SSOT Phase 051 §5.1 — PreviewModule (gatekeeper + chunk/token + REST + GQL)
// Canonical: apps/backend/src/modules/preview/preview.module.ts
// (legacy src/backend/modules/preview/preview.module.ts)
// - useFactory wiring keeps services tsx-importable (Phase 047 precedent).
// - PrismaService + RedisClusterService arrive via global InfraModule;
//   R2StorageService exposes getObjectText/getObjectBuffer (Phase 036 surface).
import { Module } from '@nestjs/common';
import { R2StorageModule } from '../../infra/cloudflare/r2-storage.module';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { EbookPreviewController } from './controllers/ebook-preview.controller';
import { VideoPreviewController } from './controllers/video-preview.controller';
import { PreviewResolver } from './resolvers/preview.resolver';
import { EbookChunkService, type PreviewChunkR2Port } from './services/ebook-chunk.service';
import { PreviewHlsTokenService } from './services/hls-token.service';
import {
  PreviewGatekeeperService,
  type PreviewDbPort,
  type PreviewEventSink,
} from './services/preview-gatekeeper.service';

@Module({
  imports: [R2StorageModule],
  controllers: [EbookPreviewController, VideoPreviewController],
  providers: [
    {
      provide: PreviewGatekeeperService,
      useFactory: (prisma: PrismaService, edge: RedisClusterService): PreviewGatekeeperService =>
        new PreviewGatekeeperService(
          prisma as unknown as PreviewDbPort,
          {
            emit: async (message: string): Promise<void> => {
              await edge.publish('preview-events', message);
            },
          } satisfies PreviewEventSink,
        ),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: EbookChunkService,
      useFactory: (gate: PreviewGatekeeperService, vault: R2StorageService): EbookChunkService =>
        new EbookChunkService(gate, vault as unknown as PreviewChunkR2Port),
      inject: [PreviewGatekeeperService, R2StorageService],
    },
    PreviewHlsTokenService,
    PreviewResolver,
  ],
  exports: [PreviewGatekeeperService, EbookChunkService, PreviewHlsTokenService],
})
export class PreviewModule {}
