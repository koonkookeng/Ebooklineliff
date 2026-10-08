// SSOT Phase 065 §5.1 — NoteModule (offline note engine wiring)
// Canonical: apps/backend/src/modules/note/note.module.ts
// (legacy src/backend/modules/note/note.module.ts)
// - useFactory wiring keeps services tsx-importable (Phase 027–065).
// - PrismaService via global InfraModule; edge cache via RedisClusterService
//   (get/setex/del/xaddPipeline ports); R2 via R2StorageModule.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { R2StorageModule } from '../../infra/cloudflare/r2-storage.module';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { NoteService } from './services/note.service';
import { NoteAiSummarizerService } from './services/note-ai-summarizer.service';
import { NotePdfExporterService } from './services/note-pdf-exporter.service';
import { NoteResolver } from './resolvers/note.resolver';
import { NoteExportController } from './controllers/note-export.controller';

@Module({
  imports: [R2StorageModule],
  controllers: [NoteExportController],
  providers: [
    {
      provide: NoteService,
      useFactory: (prisma: PrismaService, edge: RedisClusterService): NoteService =>
        new NoteService(prisma as never, edge as never),
      inject: [PrismaService, RedisClusterService],
    },
    NoteAiSummarizerService,
    {
      provide: NotePdfExporterService,
      useFactory: (r2: R2StorageService): NotePdfExporterService => new NotePdfExporterService(r2 as never),
      inject: [R2StorageService],
    },
    NoteResolver,
  ],
  exports: [NoteService, NoteAiSummarizerService, NotePdfExporterService],
})
export class NoteModule {}
