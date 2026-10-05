/**
 * AUTO-SCAFFOLD Phase 091 — REST controller
 * SSOT: schema.md + filefolder.md | RAM<30MB | slip<1s | R2 zero-egress
 * TODO: implement per Phases/phase_*.md (schema-first, zod-validated)
 */
import { Controller, Get } from '@nestjs/common';
@Controller()
export class VectorSearchControllerController {
  @Get('health') health() { return { ok: true }; }
}
