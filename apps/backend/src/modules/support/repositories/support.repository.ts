// SSOT Phase 103 §5.1 — Support repository port + Prisma adapter
// Canonical: apps/backend/src/modules/support/repositories/support.repository.ts
// - Ticket CRUD + message stream + KB vector search (pgvector).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

export interface TicketRow {
  id: string;
  ticketNo: string;
  userId: string;
  categoryId: string;
  subject: string;
  priority: string;
  status: string;
  assignedTo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRow {
  id: string;
  ticketId: string;
  senderType: string;
  senderId: string | null;
  messageText: string;
  createdAt: Date;
}

export interface KBRow {
  id: string;
  tenantId: string;
  category: string;
  question: string;
  answer: string;
  isPublished: boolean;
}

export interface SupportRepository {
  // Categories
  findAllCategories(): Promise<Array<{ id: string; name: string }>>;
  findCategoryById(id: string): Promise<{ id: string; name: string } | null>;
  createCategory(name: string, description?: string): Promise<{ id: string }>;

  // Tickets
  createTicket(data: {
    ticketNo: string;
    userId: string;
    categoryId: string;
    subject: string;
    priority: string;
    initialMessage: string;
  }): Promise<TicketRow>;
  findTicketById(id: string): Promise<TicketRow | null>;
  findTicketsByUser(userId: string, status?: string): Promise<TicketRow[]>;
  updateTicketStatus(id: string, status: string): Promise<void>;
  assignAgent(ticketId: string, agentId: string): Promise<void>;
  findOpenTickets(limit: number): Promise<TicketRow[]>;

  // Messages
  addMessage(data: {
    ticketId: string;
    senderType: string;
    senderId: string | null;
    messageText: string;
  }): Promise<MessageRow>;
  listMessages(ticketId: string, limit: number): Promise<MessageRow[]>;
  findMessageById(id: string): Promise<MessageRow | null>;

  // Attachments (Task 5: R2 zero-egress vault)
  addAttachment(data: {
    messageId: string;
    fileUrl: string;
    fileType: string;
    fileSize: number;
  }): Promise<{ id: string }>;

  // Knowledge Base
  searchKB(query: string, tenantId: string, limit: number): Promise<Array<KBRow & { similarity: number }>>;
  addKBEntry(data: { tenantId: string; category: string; question: string; answer: string }): Promise<{ id: string }>;
}

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function toRepo(db: Db): SupportRepository {
  const cats = db['supportCategory'];
  const tickets = db['supportTicket'];
  const messages = db['ticketMessage'];
  const kb = db['knowledgeBaseVector'];
  const attachments = db['ticketAttachment'];
  return {
    async findAllCategories() {
      const rows = (await cats.findMany({ orderBy: { name: 'asc' } }).catch(() => [])) as unknown as Array<{ id: string; name: string }>;
      return rows;
    },
    async findCategoryById(id) {
      const row = (await cats.findUnique({ where: { id } }).catch(() => null)) as unknown as { id: string; name: string } | null;
      return row;
    },
    async createCategory(name, description) {
      const row = (await cats.create({ data: { name, description } })) as unknown as { id: string };
      return { id: row.id };
    },
    async createTicket(data) {
      const row = (await tickets.create({
        data: {
          ticketNo: data.ticketNo,
          userId: data.userId,
          categoryId: data.categoryId,
          subject: data.subject,
          priority: data.priority,
          status: 'OPEN',
        },
      })) as unknown as TicketRow;
      // Add initial message
      await messages.create({
        data: { ticketId: row.id, senderType: 'USER', messageText: data.initialMessage },
      });
      return row;
    },
    async findTicketById(id) {
      const row = (await tickets.findUnique({ where: { id } }).catch(() => null)) as unknown as TicketRow | null;
      return row;
    },
    async findTicketsByUser(userId, status) {
      const rows = (await tickets
        .findMany({
          where: { userId, ...(status ? { status } : {}) },
          orderBy: { createdAt: 'desc' },
        })
        .catch(() => [])) as unknown as TicketRow[];
      return rows;
    },
    async updateTicketStatus(id, status) {
      await tickets.update({ where: { id }, data: { status } }).catch(() => null);
    },
    async assignAgent(ticketId, agentId) {
      await tickets.update({ where: { id: ticketId }, data: { assignedTo: agentId, status: 'IN_PROGRESS' } }).catch(() => null);
    },
    async findOpenTickets(limit) {
      const rows = (await tickets
        .findMany({
          where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
          orderBy: { createdAt: 'asc' },
          take: limit,
        })
        .catch(() => [])) as unknown as TicketRow[];
      return rows;
    },
    async addMessage(data) {
      const row = (await messages.create({ data })) as unknown as MessageRow;
      return row;
    },
    async listMessages(ticketId, limit) {
      const rows = (await messages
        .findMany({
          where: { ticketId },
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
        .catch(() => [])) as unknown as MessageRow[];
      return rows.reverse();
    },
    async findMessageById(id) {
      const row = (await messages.findUnique({ where: { id } }).catch(() => null)) as unknown as MessageRow | null;
      return row;
    },
    async addAttachment(data) {
      const row = (await attachments.create({ data })) as unknown as { id: string };
      return { id: row.id };
    },
    async searchKB(query, tenantId, limit) {
      // This is a stub - real implementation uses pgvector raw SQL (Phase 091/103)
      // Returns empty for now; real impl in ai-bot/rag-search.service
      return [];
    },
    async addKBEntry(data) {
      const row = (await kb.create({ data: { ...data, isPublished: true } })) as unknown as { id: string };
      return { id: row.id };
    },
  };
}

@Injectable()
export class PrismaSupportRepository implements SupportRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): SupportRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  findAllCategories() { return this.root.findAllCategories(); }
  findCategoryById(id: string) { return this.root.findCategoryById(id); }
  createCategory(name: string, description?: string) { return this.root.createCategory(name, description); }
  // Gate 7: ticket + initial message commit atomically — no orphan tickets.
  async createTicket(data: { ticketNo: string; userId: string; categoryId: string; subject: string; priority: string; initialMessage: string }): Promise<TicketRow> {
    const p = this.prisma as unknown as {
      supportTicket: { create: (a: unknown) => Promise<TicketRow> };
      ticketMessage: { create: (a: unknown) => Promise<unknown> };
      $transaction: (fn: (tx: unknown) => Promise<TicketRow>) => Promise<TicketRow>;
    };
    return p.$transaction(async (tx) => {
      const t = tx as typeof p;
      const row = await t.supportTicket.create({
        data: {
          ticketNo: data.ticketNo,
          userId: data.userId,
          categoryId: data.categoryId,
          subject: data.subject,
          priority: data.priority,
          status: 'OPEN',
        },
      });
      await t.ticketMessage.create({
        data: { ticketId: row.id, senderType: 'USER', messageText: data.initialMessage },
      });
      return row;
    });
  }
  findTicketById(id: string) { return this.root.findTicketById(id); }
  findTicketsByUser(userId: string, status?: string) { return this.root.findTicketsByUser(userId, status); }
  updateTicketStatus(id: string, status: string) { return this.root.updateTicketStatus(id, status); }
  assignAgent(ticketId: string, agentId: string) { return this.root.assignAgent(ticketId, agentId); }
  findOpenTickets(limit: number) { return this.root.findOpenTickets(limit); }
  addMessage(data: { ticketId: string; senderType: string; senderId: string | null; messageText: string }) {
    return this.root.addMessage(data);
  }
  listMessages(ticketId: string, limit: number) { return this.root.listMessages(ticketId, limit); }
  findMessageById(id: string) { return this.root.findMessageById(id); }
  addAttachment(data: { messageId: string; fileUrl: string; fileType: string; fileSize: number }) {
    return this.root.addAttachment(data);
  }
  searchKB(query: string, tenantId: string, limit: number) { return this.root.searchKB(query, tenantId, limit); }
  addKBEntry(data: { tenantId: string; category: string; question: string; answer: string }) {
    return this.root.addKBEntry(data);
  }
}