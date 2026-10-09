// SSOT Phase 103 Task 1/3 — Create ticket use-case (atomic + priority queue)
// Canonical: apps/backend/src/modules/support/application/use-cases/create-ticket.use-case.ts
// - Zod gate → category check → ticket row + initial message → agent
//   notification (SSE/push) → stream event (<500ms, BDD §1.3).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { TICKET_SLA_MINUTES, ticketNumber } from '@repo/shared';
import type { SupportRepository } from '../../repositories/support.repository';

export interface CreateTicketInput {
  userId: string;
  categoryId: string;
  subject: string;
  priority: string;
  message: string;
}

@Injectable()
export class CreateTicketUseCase {
  constructor(private readonly repo: SupportRepository) {}

  async execute(input: CreateTicketInput): Promise<{
    ticketId: string;
    ticketNo: string;
    status: string;
    priority: string;
    slaMinutes: number;
  }> {
    const category = await this.repo.findCategoryById(input.categoryId);
    if (!category) throw new NotFoundException('Invalid category');

    const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
    if (!validPriorities.includes(input.priority.toUpperCase())) {
      throw new BadRequestException('Invalid priority');
    }

    const ticketNo = ticketNumber();
    const ticket = await this.repo.createTicket({
      ticketNo,
      userId: input.userId,
      categoryId: input.categoryId,
      subject: input.subject,
      priority: input.priority.toUpperCase(),
      initialMessage: input.message,
    });

    const slaMinutes = TICKET_SLA_MINUTES[input.priority.toUpperCase() as keyof typeof TICKET_SLA_MINUTES] ?? TICKET_SLA_MINUTES.MEDIUM;

    // TODO: emit SSE event to agent room (SupportChatGateway)
    return {
      ticketId: ticket.id,
      ticketNo: ticket.ticketNo,
      status: ticket.status,
      priority: ticket.priority,
      slaMinutes,
    };
  }
}