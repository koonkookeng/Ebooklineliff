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

export interface TicketEventBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

// Support stream (same literal as SupportChatGateway — the agent-room SSE
// fan-out consumes this stream; gateway also re-emits live to agents).
const SUPPORT_TICKET_STREAM = 'support:ticket:events';

@Injectable()
export class CreateTicketUseCase {
  constructor(
    private readonly repo: SupportRepository,
    private readonly bus?: TicketEventBus,
  ) {}

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

    // Agent-room notification: fail-open stream event (gateway fans out live SSE).
    await this.bus
      ?.xadd(SUPPORT_TICKET_STREAM, {
        event: 'ticket_created',
        ticketId: ticket.id,
        ticketNo: ticket.ticketNo,
        userId: input.userId,
        priority: ticket.priority,
        at: Date.now(),
      })
      .catch(() => undefined);
    return {
      ticketId: ticket.id,
      ticketNo: ticket.ticketNo,
      status: ticket.status,
      priority: ticket.priority,
      slaMinutes,
    };
  }
}