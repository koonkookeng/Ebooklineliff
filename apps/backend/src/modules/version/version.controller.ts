// SSOT Phase 033 Task 2/§5.2 — Version REST controller (public cold-start check)
// Canonical: apps/backend/src/modules/version/version.controller.ts
// (legacy src/backend/modules/version/version.controller.ts)
// - POST /api/v1/version/check — PUBLIC (logged-out LIFF opens must version-
//   check; request/response carry no PII — versions + hashes only).
// - Device meta (ip/ua) is server-observed, never client-asserted (Gate 4).
// - Zero new deps.
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { VersionService } from './version.service';

interface VersionRequest {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
}

function header(headers: VersionRequest['headers'], name: string): string | undefined {
  const v = headers?.[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s : undefined;
}

@Controller('api/v1/version')
export class VersionController {
  constructor(private readonly versions: VersionService) {}

  @Post('check')
  @HttpCode(HttpStatus.OK)
  checkVersion(@Body() body: unknown, @Req() req: VersionRequest) {
    const forwarded = header(req.headers, 'x-forwarded-for');
    const ip = forwarded?.split(',')[0].trim() || req.ip;
    const ua = (header(req.headers, 'user-agent') || '').slice(0, 500);
    return this.versions.evaluateClientVersion(body, {
      ...(ip ? { ipAddress: ip } : {}),
      ...(ua ? { userAgent: ua } : {}),
    });
  }
}
