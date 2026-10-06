// SSOT Phase 018 §5 — Library REST (Next.js proxy path: assets + gate)
// Canonical: apps/backend/src/modules/library/controllers/library.controller.ts
// (legacy src/backend/modules/library/controllers/library.controller.ts)
import { Controller, Get, Query, Req, UseGuards, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { MyLibraryQueryInputSchema } from '@repo/shared';
import { LibraryService } from '../services/library.service';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';

interface AuthedReq {
  user?: { id?: string };
}

function actor(req: AuthedReq): string {
  if (!req.user?.id) throw new UnauthorizedException('Unauthorized');
  return req.user.id;
}

@Controller('api/library')
@UseGuards(JwtAuthGuard)
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get('assets')
  assets(
    @Query('assetType') assetType: string | undefined,
    @Query('searchQuery') searchQuery: string | undefined,
    @Query('sortBy') sortBy: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: AuthedReq,
  ) {
    const parsed = MyLibraryQueryInputSchema.safeParse({
      ...(assetType ? { assetType } : {}),
      ...(searchQuery ? { searchQuery } : {}),
      ...(sortBy ? { sortBy } : {}),
      ...(page ? { page: Number.parseInt(page, 10) } : {}),
      ...(limit ? { limit: Number.parseInt(limit, 10) } : {}),
    });
    if (!parsed.success) throw new BadRequestException('Invalid library query');
    return this.library.getUserLibraryAssets(actor(req), parsed.data);
  }

  @Get('gate')
  gate(@Query('productId') productId: string | undefined, @Req() req: AuthedReq) {
    if (!productId) throw new BadRequestException('Missing product id');
    return this.library.checkAccess(actor(req), productId);
  }
}
