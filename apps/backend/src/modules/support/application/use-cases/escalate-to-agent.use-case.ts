// SSOT Phase 103 Task 4 — Escalation use-case (AI → human handoff)
// Canonical: apps/backend/src/modules/support/application/use-cases/escalate-to-agent.use-case.ts
// - AI result confidence < 0.6 OR negative sentiment → ticket created
//   with HIGH priority → agent room SSE alert + ticket link.
//   <500ms SLA (BDD §1.3). Port-based for tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { TICKET_SLA_MINUTES, ticketNumber } from '@repo/shared';
import type { SupportRepository } from '../../repositories/support.repository';

export interface EscalationInput {
  userId: string;
  tenantId: string;
  sessionId: string;
  message: string;
  categoryId: string;
  confidenceScore: number;
  sentiment: 'positive' | 'negative' | 'neutral';
}

@Injectable()
export class EscalateToAgentUseCase {
  constructor(private readonly repo: SupportRepository) {}

  async execute(input: EscalationInput): Promise<{
    ticketId: string;
    ticketNo: string;
    status: string;
    priority: string;
  }> {
    const category = await this.repo.findCategoryById(input.categoryId);
    if (!category) throw new Error('Invalid category');

    const ticketNo = ticketNumber();
    const subject = `Auto Escalation: ${input.message.substring(0, 50)}...`;
    const ticket = await this.repo.createTicket({
      ticketNo,
      userId: input.userId,
      categoryId: input.categoryId,
      subject,
      priority: 'HIGH',
      initialMessage: input.message,
    });

    // The SSE alert to agent room is emitted by the gateway after this use-case returns
    return {
      ticketId: ticket.id,
      ticketNo: ticket.ticketNo,
      status: ticket.status,
      priority: ticket.priority,
    };
  }
}