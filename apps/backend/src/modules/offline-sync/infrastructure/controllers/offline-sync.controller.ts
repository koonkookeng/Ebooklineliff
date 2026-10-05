/**
 * AUTO-SCAFFOLD Phase 062 — REST controller
 * SSOT: schema.md + filefolder.md | RAM<30MB | slip<1s | R2 zero-egress
 * TODO: implement per Phases/phase_*.md (schema-first, zod-validated)
 */
import { Controller, Get } from '@nestjs/common';
@Controller()
export class OfflineSyncControllerController {
  @Get('health') health() { return { ok: true }; }
}
