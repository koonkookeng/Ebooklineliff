// SSOT Phase 012 §6.1 — Slip upload REST (spec path /api/storage/upload-slip)
// Canonical: apps/backend/src/modules/order/presentation/rest/slip-upload.controller.ts
// Body is JSON {orderId, filename, contentType, dataBase64} so no multipart dep is
// needed (Next.js converts the LIFF file picker FormData → base64 upstream).
import { Controller, Post, Body, Req, UseGuards, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { SlipUploadService } from '../../services/slip-upload.service';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';

const UploadBodySchema = z.object({
  orderId: z.string().uuid(),
  filename: z.string().max(255).default('slip.png'),
  contentType: z.string().max(100).default('image/png'),
  dataBase64: z.string().min(1).max(8 * 1024 * 1024),
  // Phase 014 §7: tenant attribution for the payment_slip_uploaded event.
  tenantId: z.string().min(1).max(100).optional(),
});

@Controller('api/storage')
@UseGuards(JwtAuthGuard)
export class SlipUploadController {
  constructor(private readonly uploads: SlipUploadService) {}

  @Post('upload-slip')
  upload(@Body() body: unknown, @Req() req: { user?: { id?: string } }) {
    if (!req.user?.id) throw new UnauthorizedException('Unauthorized');
    const parsed = UploadBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid upload payload');
    return this.uploads.uploadSlipImage(parsed.data.orderId, parsed.data.filename, parsed.data.contentType, parsed.data.dataBase64, { tenantId: parsed.data.tenantId });
  }
}
