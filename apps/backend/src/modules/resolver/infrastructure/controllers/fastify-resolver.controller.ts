/**
 * AUTO-SCAFFOLD Phase 025 — REST controller
 * SSOT: schema.md + filefolder.md | RAM<30MB | slip<1s | R2 zero-egress
 * TODO: implement per Phases/phase_*.md (schema-first, zod-validated)
 */
import { Controller, Get } from '@nestjs/common';
@Controller()
export class FastifyResolverControllerController {
  @Get('health') health() { return { ok: true }; }
}
