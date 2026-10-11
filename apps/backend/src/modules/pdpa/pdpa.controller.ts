// SSOT Phase 129 §5.1 — PDPA REST lane (JWT-guarded, Zod-gated)
// Canonical: apps/backend/src/modules/pdpa/pdpa.controller.ts
// (legacy src/backend/modules/pdpa/pdpa.controller.ts)
// - GET consent/status / PUT consent / POST dsr / GET dsr /
//   GET export (inline bundle + HMAC ticket) / POST dsr/:id/erase (admin).
//   Identity rides req.user (JwtAuthGuard, pii.controller precedent).
// - Zero new deps.
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import {
  DATA_EXPORT_TTL_SEC,
  PDPAConsentPayloadSchema,
  DataSubjectRequestSchema,
} from '@repo/shared';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { ConsentManagerService } from './services/consent-manager.service';
import { DsrEngineService } from './services/dsr-engine.service';

type AuthedReq = {
  user?: { id?: string; role?: string };
  headers?: Record<string, string | undefined>;
  ip?: string;
};

function actorOf(req: AuthedReq): { id: string; ip: string; ua: string } {
  if (!req.user?.id) throw new BadRequestException('Missing authentication');
  return {
    id: req.user.id,
    ip: req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '0.0.0.0',
    ua: req.headers?.['user-agent'] ?? 'unknown',
  };
}

@Controller('api/v1/pdpa')
@UseGuards(JwtAuthGuard)
export class PdpaController {
  constructor(
    private readonly consents: ConsentManagerService,
    private readonly dsr: DsrEngineService,
  ) {}

  @Get('consent/status')
  async consentStatus(@Req() req: AuthedReq) {
    return this.consents.statusPayload(actorOf(req).id);
  }

  @Put('consent')
  async updateConsent(@Req() req: AuthedReq, @Body() body: unknown) {
    const actor = actorOf(req);
    const parsed = PDPAConsentPayloadSchema.safeParse({
      ...(typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}),
      ipAddress: actor.ip,
      userAgent: actor.ua,
      acceptedAt: new Date().toISOString(),
    });
    if (!parsed.success) throw new BadRequestException('Invalid consent payload');
    return this.consents.recordConsent(actor.id, parsed.data);
  }

  @Post('dsr')
  async submitDsr(@Req() req: AuthedReq, @Body() body: unknown) {
    const actor = actorOf(req);
    const raw = (typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {});
    const parsed = DataSubjectRequestSchema.safeParse({
      ...raw,
      identityVerificationProof: `jwt:${actor.id}`,
    });
    if (!parsed.success) throw new BadRequestException('Invalid DSR payload');
    return this.dsr.submit(actor.id, {
      requestType: parsed.data.requestType,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    });
  }

  @Get('dsr')
  async myDsr(@Req() req: AuthedReq) {
    return this.dsr.myRequests(actorOf(req).id);
  }

  @Get('export')
  async exportMine(@Req() req: AuthedReq) {
    const actor = actorOf(req);
    const bundle = await this.dsr.exportPackage(actor.id);
    const secret = process.env.PDPA_EXPORT_SECRET ?? 'pdpa-export-dev-secret';
    const ticket = createHmac('sha256', secret)
      .update(`${actor.id}:${Date.now()}`, 'utf8')
      .digest('hex');
    return {
      ...bundle,
      downloadTicket: ticket,
      expiresAt: new Date(Date.now() + DATA_EXPORT_TTL_SEC * 1000).toISOString(),
    };
  }

  @Post('dsr/:id/erase')
  async erase(@Req() req: AuthedReq, @Param('id') id: string) {
    // Owner-only lane (fail-closed): executeErasure 404s on foreign ids.
    // Admin arbitration rides the admin-user console (109 lane), not here.
    const actor = actorOf(req);
    return this.dsr.executeErasure(actor.id, id, actor.id);
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const PdpaControllerController = PdpaController;
