// SSOT Phase 003 §5.1 — identity REST presentation (KYC submit)
import { Controller, Post, Body, Req, BadRequestException } from '@nestjs/common';
import { KYCService } from '../../application/kyc.service';
import { CreatorKYCSchema } from '@repo/shared';

@Controller('identity')
export class KycController {
  constructor(private readonly kyc: KYCService) {}

  @Post('kyc/submit')
  submit(@Req() req: { user?: { id: string } }, @Body() body: unknown) {
    if (!req.user?.id) {
      throw new BadRequestException('Unauthenticated');
    }
    const parsed = CreatorKYCSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Invalid KYC payload');
    }
    return this.kyc.submitKYC(req.user.id, parsed.data);
  }
}
