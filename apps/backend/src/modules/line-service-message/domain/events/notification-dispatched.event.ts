// SSOT Phase 024 — Domain event: notification dispatched (fan-out trigger seam)
// Canonical: apps/backend/src/modules/line-service-message/domain/events/notification-dispatched.event.ts
// Order/slip modules (READ_ONLY) can emit this shape to trigger dispatch without
// touching payment core (OUT_OF_SCOPE_STRICT): the processor subscribes, core stays clean.
import type { ServiceMessageType } from '@repo/shared';

export const NOTIFICATION_DISPATCH_REQUESTED = 'line.service-message.dispatch-requested';

export interface NotificationDispatchRequestedEvent {
  event: typeof NOTIFICATION_DISPATCH_REQUESTED;
  tenantId: string;
  userId: string;
  lineUserId: string;
  messageType: ServiceMessageType;
  parameters: Record<string, string | number | boolean>;
  fallbackPhone?: string;
  at: string;
}
