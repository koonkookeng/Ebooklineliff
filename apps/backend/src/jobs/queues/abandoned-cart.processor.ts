// SSOT Phase 084 Task 4 — Legacy jobs-path alias (canonical lives in messaging)
// Canonical: apps/backend/src/jobs/queues/abandoned-cart.processor.ts
// Re-export only (078–083 alias precedent); registered once via MessagingModule.
export { AbandonedCartProcessor } from '../../modules/messaging/queues/abandoned-cart.processor';
