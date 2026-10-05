/**
 * AUTO-SCAFFOLD Phase 119 — NestJS guard
 * SSOT: schema.md + filefolder.md | RAM<30MB | slip<1s | R2 zero-egress
 * TODO: implement per Phases/phase_*.md (schema-first, zod-validated)
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
@Injectable()
export class DeviceFingerprintGuardGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean { return true; }
}
