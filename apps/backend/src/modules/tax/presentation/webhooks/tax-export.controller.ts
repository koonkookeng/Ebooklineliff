// SSOT Phase 082 Task 8 — e-Tax monthly export + signed download (admin + public ticket)
// Canonical: apps/backend/src/modules/tax/presentation/webhooks/tax-export.controller.ts
// - GET admin/export-month?year=&month= (admin role): pipe-delimited
//   PND3/PND53 lines + marks rows submitted with a batch ref (Gate 8).
// - GET download?ticket= (public): 15-min HMAC ticket → R2 object stream.
//   No auth session needed — the ticket IS the auth (timing-safe verify).
// - Zero new deps.
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../../common/guards/tenant.guard';
import { eTaxLine, verifyDownloadTicket } from '@repo/shared';
import { PrismaTaxRepository } from '../../infrastructure/repositories/tax-prisma.repository';
import { R2StorageService } from '../../../../infra/cloudflare/r2-storage.service';

type LooseReq = Record<string, unknown>;

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN']);

function isAdmin(req: LooseReq): boolean {
  const user = (req['user'] as { role?: string } | undefined) ?? {};
  return !!user.role && ADMIN_ROLES.has(user.role);
}

@Controller('api/v1/tax')
export class TaxExportController {
  constructor(
    private readonly repo: PrismaTaxRepository,
    private readonly r2: R2StorageService,
  ) {}

  @Get('admin/export-month')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async exportMonth(
    @Req() req: LooseReq,
    @Query('year') year: string | undefined,
    @Query('month') month: string | undefined,
    @Query('formType') formType: string | undefined,
  ) {
    if (!isAdmin(req)) throw new ForbiddenException('e-Tax export requires admin role');
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      throw new BadRequestException('Invalid year/month');
    }
    const form = formType || 'PND_3';
    const rows = await this.repo.exportMonth(y, m);
    const lines = rows.map((r) =>
      eTaxLine({
        formType: form,
        certificateNo: r.certificateNo,
        payeeTaxId: r.payeeTaxId,
        grossAmount: r.grossAmount,
        taxWithheld: r.taxWithheld,
        paymentDate: r.paymentDate.toISOString(),
      }),
    );
    return {
      formType: form,
      year: y,
      month: m,
      count: rows.length,
      batchRef: `ETAX-${y}${String(m).padStart(2, '0')}`,
      content: lines.join('\n'),
    };
  }

  @Get('download')
  async download(@Query('ticket') ticket: string | undefined, @Res() res: {
    set(h: Record<string, string>): void;
    send(b: unknown): void;
    status(c: number): { json(b: unknown): void };
  }) {
    if (!ticket) throw new BadRequestException('Missing download ticket');
    const secret = process.env['TAX_TICKET_SECRET'] || process.env['JWT_SECRET'] || 'secret-key-144-xz';
    const certificateId = verifyDownloadTicket(secret, ticket);
    if (!certificateId) {
      res.status(403).json({ message: 'Expired or invalid download link' });
      return;
    }
    const cert = await this.repo.findCertificate(certificateId);
    if (!cert) {
      res.status(404).json({ message: 'Certificate not found' });
      return;
    }
    const buf = await this.r2.getObjectBuffer(cert.pdfStoragePathR2).catch(() => null);
    if (!buf) {
      res.status(404).json({ message: 'PDF not found in vault' });
      return;
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${cert.certificateNo}.pdf"`,
      'Cache-Control': 'private, max-age=60',
    });
    res.send(buf);
  }
}
