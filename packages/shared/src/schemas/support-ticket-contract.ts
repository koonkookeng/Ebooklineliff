// SSOT Phase 103 §3.1 — Support & Helpdesk Zod domain contract
// Canonical: packages/shared/src/schemas/support-ticket-contract.ts
// - Spec-verbatim: TicketStatusEnum / TicketPriorityEnum / SenderTypeEnum /
//   SupportTicketPayloadSchema / BotQueryInputSchema /
//   AIResponsePayloadSchema (§3.1).
// - Pure helpers: ticketNo, category keys, SLA. Zod only.
import { z } from 'zod';

export const TicketStatusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_USER_RESPONSE', 'RESOLVED', 'CLOSED']);
export type TicketStatus = z.infer<typeof TicketStatusEnum>;

export const TicketPriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export type TicketPriority = z.infer<typeof TicketPriorityEnum>;

export const SenderTypeEnum = z.enum(['USER', 'AI_BOT', 'HUMAN_AGENT', 'SYSTEM_ALERT']);
export type SenderType = z.infer<typeof SenderTypeEnum>;

export const SupportTicketPayloadSchema = z.object({
  ticketId: z.string().uuid(),
  ticketNo: z.string(),
  userId: z.string().uuid(),
  category: z.string(),
  subject: z.string().min(5).max(200),
  priority: TicketPriorityEnum,
  status: TicketStatusEnum,
  createdAt: z.string(),
});
export type SupportTicketPayload = z.infer<typeof SupportTicketPayloadSchema>;

export const BotQueryInputSchema = z.object({
  userId: z.string(),
  queryText: z.string().min(1).max(1000),
  tenantId: z.string(),
  conversationContext: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })).optional(),
});
export type BotQueryInput = z.infer<typeof BotQueryInputSchema>;

export const AIResponsePayloadSchema = z.object({
  answerText: z.string(),
  confidenceScore: z.number().min(0).max(1),
  suggestedActions: z.array(z.object({
    label: z.string(),
    actionUrl: z.string().optional(),
    intentCode: z.string().optional(),
  })),
  shouldEscalateToHuman: z.boolean(),
});
export type AIResponsePayload = z.infer<typeof AIResponsePayloadSchema>;

/** Ticket SLA targets by priority (minutes). */
export const TICKET_SLA_MINUTES = {
  URGENT: 15,
  HIGH: 60,
  MEDIUM: 240,
  LOW: 1440,
} as const;

/** First-contact resolution target: 5 minutes silence (BDD §7.1). */
export const FCR_SILENCE_MINUTES = 5;

/** Ticket number generator: TKT-<base36 time>-<rand4>. */
export function ticketNumber(at = Date.now(), rand = Math.floor(Math.random() * 36 ** 4)): string {
  return `TKT-${at.toString(36).toUpperCase()}-${rand.toString(36).toUpperCase().padStart(4, '0')}`;
}

/** Redis key for a ticket's message stream (SSE fan-out). */
export function ticketMessageStreamKey(ticketId: string): string {
  return `support:ticket:${ticketId}:messages`;
}

/** Redis key for a ticket's assigned agent (concurrency guard). */
export function ticketAgentLockKey(ticketId: string): string {
  return `lock:support:agent:${ticketId}`;
}

/** Escalation threshold: confidence < 0.6 triggers human handoff (BDD §1.3). */
export const ESCALATION_CONFIDENCE_THRESHOLD = 0.6;