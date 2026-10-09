// SSOT Phase 102 §5.1 — VOD pipeline status aggregate (pure machine)
// Canonical: apps/backend/src/modules/stream/domain/live-session.aggregate.ts
// - Pipeline lifecycle (NOT the 099 session lifecycle): SCHEDULED →
//   LIVE_NOW → PROCESSING_VOD → VOD_AVAILABLE, FAILED from anywhere except
//   VOD_AVAILABLE. Pure (no imports). Zero new deps.
export type VodStage = 'SCHEDULED' | 'LIVE_NOW' | 'PROCESSING_VOD' | 'VOD_AVAILABLE' | 'FAILED';

const NEXT: Record<VodStage, VodStage[]> = {
  SCHEDULED: ['LIVE_NOW'],
  LIVE_NOW: ['PROCESSING_VOD', 'FAILED'],
  PROCESSING_VOD: ['VOD_AVAILABLE', 'FAILED'],
  VOD_AVAILABLE: [],
  FAILED: ['PROCESSING_VOD'],
};

export function canPipelineTransition(from: VodStage, to: VodStage): boolean {
  return (NEXT[from] ?? []).includes(to);
}

export function assertPipelineTransition(from: VodStage, to: VodStage): void {
  if (!canPipelineTransition(from, to)) {
    throw new Error(`Illegal VOD transition ${from} → ${to}`);
  }
}

export function isTerminalStage(stage: VodStage): boolean {
  return stage === 'VOD_AVAILABLE';
}
