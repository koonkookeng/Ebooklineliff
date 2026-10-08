// SSOT Phase 062 §5.2 — OfflineSyncController (bulk flush REST)
// Canonical: apps/backend/src/modules/offline-sync/infrastructure/controllers/offline-sync.controller.ts
// (legacy src/backend/modules/offline-sync → same canonical home)
// - POST /api/v1/offline-sync/bulk (JWT; identity from req.user —
//   zero-trust: body userIds must equal the JWT subject, else failedIds).
// - No global ZodValidationPipe exists; the use-case gates via safeParse
//   (controller-boundary precedent). Zero new deps.
import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { ProcessBulkSyncUseCase } from '../../application/use-cases/process-bulk-sync.use-case';

interface BulkReq {
  user?: { id?: string };
  headers?: Record<string, string | undefined>;
}

@Controller('api/v1/offline-sync')
export class OfflineSyncController {
  constructor(private readonly bulk: ProcessBulkSyncUseCase) {}

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async processBulkSync(@Body() body: unknown, @Req() req: BulkReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    return this.bulk.execute(userId, body, req.headers?.['x-device-id']);
  }
}
