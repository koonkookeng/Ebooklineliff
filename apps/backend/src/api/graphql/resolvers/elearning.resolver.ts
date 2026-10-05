// SSOT Phase 004 Task 004.2 — e-learning resolver stub (full lesson engine = Phase 047+)
import { Resolver, Query } from '@nestjs/graphql';

@Resolver('ElearningPayload')
export class ElearningResolver {
  @Query('elearningHealth')
  elearningHealth(): string {
    return 'ok';
  }
}
