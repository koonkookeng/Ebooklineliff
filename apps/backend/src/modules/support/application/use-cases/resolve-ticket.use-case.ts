// SSOT Phase 103 Task 3 — Resolve ticket use-case (agent closure)
// Canonical: apps/backend/src/modules/support/application/use-cases/resolve-ticket.use-case.ts
// - Agent closes ticket → status RESOLVED → user notification →
//   FCR event if user silent 5min (BDD §7.1). Zero new deps.
import { Injectable } from '@nestjs/common';
import type { SupportRepository } from '../../repositories/support.repository';

export interface ResolveTicketInput {
  ticketId: string;
  agentId: string;
  resolutionNote: string;
}

@Injectable()
export class ResolveTicketUseCase {
  constructor(private readonly repo: SupportRepository) {}

  async execute(input: ResolveTicketInput): Promise<void> {
    const ticket = await this.repo.findTicketById(input.ticketId);
    if (!ticket) throw new Error('Ticket not found');

    await this.repo.updateTicketStatus(input.ticketId, 'RESOLVED');
    await this.repo.addMessage({
      ticketId: input.ticketId,
      senderType: 'HUMAN_AGENT',
      senderId: input.agentId,
      messageText: `Resolved: ${input.resolutionNote}`,
    });

    // TODO: notify user via SSE/push; schedule FCR silence check (5min)
  }
}