// SSOT Phase 082 — Tax REST (profile/summary/certificates/calculate/generate)
// Canonical: apps/backend/src/modules/tax/presentation/rest/tax.controller.ts
// (ADDITIVE deviation from the §5.1 tree: LIFF clients ride zero-dep REST
// proxies — 080 precedent. GQL intents stay canonical in tax.resolver.ts.)
// - All self-scope routes are JWT+Tenant guarded; download tickets ride the
//   export controller (ticket IS the auth).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../../common/guards/tenant.guard';
import { TaxProfileSchema } from '@repo/shared';
import { CalculateTaxUseCase } from '../../application/use-cases/calculate-tax.use-case';
import { Generate50TawiPdfUseCase } from '../../application/use-cases/generate-50-tawi-pdf.use-case';
import type { TaxRepository } from '../../infrastructure/repositories/tax-prisma.repository';
import { PrismaTaxRepository } from '../../infrastructure/repositories/tax-prisma.repository';

type LooseReq = Record<string, unknown>;

function tenantOf(req: LooseReq): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? headers['X-Tenant-ID'] ?? '') as string).trim();
}

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Controller('api/v1/tax')
export class TaxController {
  constructor(
    private readonly calculate: CalculateTaxUseCase,
    private readonly generate: Generate50TawiPdfUseCase,
    private readonly repo: PrismaTaxRepository,
  ) {}

  @Post('profile')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async upsertProfile(@Req() req: LooseReq, @Body() body: unknown) {
    const userId = actorOf(req);
    const parsed = TaxProfileSchema.safeParse({ ...((body ?? {}) as Record<string, unknown>), userId });
    if (!parsed.success) throw new BadRequestException('Invalid tax profile');
    const repo: TaxRepository = this.repo;
    return repo.upsertProfile({
      userId,
      payerType: parsed.data.payerType,
      taxId: parsed.data.taxId,
      fullNameOrCompanyName: parsed.data.fullNameOrCompanyName,
      branchCode: '00000',
      address: parsed.data.address,
      isTaxExempt: false,
    });
  }

  @Get('summary')
  @UseGuards(JwtAuthGuard, TenantGuard)
  summary(@Req() req: LooseReq, @Query('year') year: string | undefined) {
    const y = Number(year) || new Date().getFullYear();
    const repo: TaxRepository = this.repo;
    return repo.annualSummary(actorOf(req), y).then((s) => ({ year: y, ...s }));
  }

  @Get('certificates')
  @UseGuards(JwtAuthGuard, TenantGuard)
  certificates(@Req() req: LooseReq, @Query('limit') limit: string | undefined) {
    const repo: TaxRepository = this.repo;
    return repo.listCertificates(actorOf(req), Math.min(Number(limit) || 20, 100));
  }

  @Post('calculate')
  @UseGuards(JwtAuthGuard, TenantGuard)
  calculateTax(@Req() req: LooseReq, @Body() body: unknown) {
    return this.calculate.execute({ tenantId: tenantOf(req), actorUserId: actorOf(req), body });
  }

  @Post('certificates/generate')
  @UseGuards(JwtAuthGuard, TenantGuard)
  generateCertificate(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as { grossAmount?: number; incomeType?: string; formType?: string };
    if (!(Number(b.grossAmount) > 0)) throw new BadRequestException('Gross amount must be positive');
    return this.generate.execute({
      tenantId: tenantOf(req),
      actorUserId: actorOf(req),
      grossAmount: Number(b.grossAmount),
      incomeType: b.incomeType,
      formType: b.formType,
    });
  }
}
