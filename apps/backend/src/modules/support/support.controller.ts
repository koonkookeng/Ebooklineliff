// SSOT Phase 103 — Support REST + SSE endpoints
// Canonical: apps/backend/src/modules/support/support.controller.ts
// - POST tickets / GET tickets / POST messages / GET messages / SSE stream
//   / POST escalate / POST resolve. JWT + tenant guards. Zero new deps.
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CreateTicketUseCase } from './application/use-cases/create-ticket.use-case';
import { EscalateToAgentUseCase } from './application/use-cases/escalate-to-agent.use-case';
import { ResolveTicketUseCase } from './application/use-cases/resolve-ticket.use-case';
import { SupportChatGateway } from './infrastructure/websocket/support-chat.gateway';
import { PrismaSupportRepository } from './repositories/support.repository';
import { RAGSearchService } from '../ai-bot/application/rag-search.service';
import { SentimentAnalyzerService } from '../ai-bot/application/sentiment-analyzer.service';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { randomUUID } from 'node:crypto';

type LooseReq = Record<string, unknown>;

/** PII redaction guardrail (§8.2): mask before DB/LLM. Logs stay traceable, values stay useless. */
export function redactPII(text: string): string {
  return text
    .replace(/[0-9]{13}/g, '[ID-MASKED]')
    .replace(/0[0-9]{9}/g, '[PHONE-MASKED]')
    .replace(/[0-9]{10,12}/g, '[ACCOUNT-MASKED]');
}

function actorOf(req: LooseReq): { userId: string; role: string; tenantId: string } {
  const user = (req['user'] as { id?: string; role?: string; tenantId?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return { userId: user.id, role: user.role ?? 'MEMBER', tenantId: user.tenantId ?? 'default' };
}

function assertAgent(role: string): void {
  if (role !== 'ADMIN' && role !== 'SUPPORT_STAFF' && role !== 'SUPER_ADMIN') {
    throw new ForbiddenException('Agent role required');
  }
}

@Controller('api/v1/support')
export class SupportController {
  constructor(
    private readonly createTicket: CreateTicketUseCase,
    private readonly escalate: EscalateToAgentUseCase,
    private readonly resolve: ResolveTicketUseCase,
    private readonly repo: PrismaSupportRepository,
    private readonly gateway: SupportChatGateway,
    private readonly rag: RAGSearchService,
    private readonly sentiment: SentimentAnalyzerService,
    private readonly r2: R2StorageService,
  ) {}

  // ===== Tickets =====
  @Post('tickets')
  @UseGuards(JwtAuthGuard, TenantGuard)
  create(@Req() req: LooseReq, @Body() body: unknown) {
    const { userId } = actorOf(req);
    const b = (body ?? {}) as { categoryId?: string; subject?: string; priority?: string; message?: string };
    if (!b.categoryId || !b.subject || !b.message) throw new BadRequestException('Missing fields');
    return this.createTicket.execute({
      userId,
      categoryId: b.categoryId,
      subject: redactPII(b.subject),
      priority: b.priority ?? 'MEDIUM',
      message: redactPII(b.message),
    });
  }

  @Get('tickets')
  @UseGuards(JwtAuthGuard, TenantGuard)
  myTickets(@Req() req: LooseReq, @Query('status') status?: string) {
    const { userId } = actorOf(req);
    return this.repo.findTicketsByUser(userId, status);
  }

  @Get('tickets/:id')
  @UseGuards(JwtAuthGuard, TenantGuard)
  getTicket(@Param('id') id: string) {
    return this.repo.findTicketById(id);
  }

  // ===== Messages =====
  @Post('tickets/:id/messages')
  @UseGuards(JwtAuthGuard, TenantGuard)
  addMessage(@Req() req: LooseReq, @Param('id') id: string, @Body() body: unknown) {
    const { userId } = actorOf(req);
    const b = (body ?? {}) as { text?: string };
    if (!b.text) throw new BadRequestException('Missing message');
    return this.repo.addMessage({ ticketId: id, senderType: 'USER', senderId: userId, messageText: redactPII(b.text) });
  }

  @Get('tickets/:id/messages')
  @UseGuards(JwtAuthGuard, TenantGuard)
  messages(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.repo.listMessages(id, limit ? Number(limit) : 50);
  }

  // SSE message stream for a ticket
  @Sse('tickets/:id/stream')
  @UseGuards(JwtAuthGuard, TenantGuard)
  messageStream(@Param('id') id: string): Observable<{ data: unknown }> {
    return new Observable((subscriber) => {
      const release = this.gateway.subscribe(id, {
        write: (chunk: string) => subscriber.next({ data: chunk }),
      });
      return release;
    });
  }

  // ===== AI RAG Query =====
  @Post('bot/query')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async botQuery(@Req() req: LooseReq, @Body() body: unknown) {
    const { userId, tenantId } = actorOf(req);
    const b = (body ?? {}) as { query?: string };
    if (!b.query) throw new BadRequestException('Missing query');
    const clean = redactPII(b.query);
    const result = await this.rag.queryKnowledgeBase(clean, tenantId);
    const sent = this.sentiment.analyze(clean);
    if (sent === 'negative' || result.shouldEscalateToHuman) {
      const cats = await this.repo.findAllCategories().catch(() => []);
      const fallbackId = cats[0]?.id;
      if (fallbackId) {
        await this.escalate
          .execute({
            userId,
            tenantId,
            sessionId: `chat-${userId}`,
            message: clean,
            categoryId: fallbackId,
            confidenceScore: result.confidenceScore,
            sentiment: sent,
          })
          .catch(() => undefined);
      }
    }
    return result;
  }

  // ===== Escalation =====
  @Post('tickets/:id/escalate')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async escalateTicket(@Req() req: LooseReq, @Param('id') id: string, @Body() body: unknown) {
    const { userId, tenantId } = actorOf(req);
    const b = (body ?? {}) as { reason?: string };
    const ticket = await this.repo.findTicketById(id);
    if (!ticket) throw new NotFoundException('Ticket not found');
    await this.repo.updateTicketStatus(id, 'IN_PROGRESS');
    await this.repo.addMessage({
      ticketId: id,
      senderType: 'USER',
      senderId: userId,
      messageText: redactPII(b.reason ?? 'Requested human agent'),
    });
    await this.gateway.alertAgents(tenantId, { id, ticketNo: ticket.ticketNo, subject: ticket.subject, priority: 'HIGH' });
    return { escalated: true };
  }

  // ===== Agent actions =====
  @Post('tickets/:id/assign')
  @UseGuards(JwtAuthGuard, TenantGuard)
  assign(@Req() req: LooseReq, @Param('id') id: string) {
    const { userId, role } = actorOf(req);
    assertAgent(role);
    return this.repo.assignAgent(id, userId);
  }

  @Post('tickets/:id/resolve')
  @UseGuards(JwtAuthGuard, TenantGuard)
  resolveTicket(@Req() req: LooseReq, @Param('id') id: string, @Body() body: unknown) {
    const { userId, role } = actorOf(req);
    assertAgent(role);
    const b = (body ?? {}) as { note?: string };
    return this.resolve.execute({ ticketId: id, agentId: userId, resolutionNote: redactPII(b.note ?? 'Resolved by agent') });
  }

  // ===== Attachments (Task 5: R2 zero-egress vault, direct-upload presigned PUT) =====
  @Post('tickets/:id/messages/:messageId/attachments')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async attachFile(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() body: unknown,
  ) {
    const b = (body ?? {}) as { fileType?: string; fileSize?: number };
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    if (!b.fileType || !allowed.includes(b.fileType)) throw new BadRequestException('Unsupported file type');
    if (!b.fileSize || b.fileSize <= 0 || b.fileSize > 10 * 1024 * 1024) {
      throw new BadRequestException('File size must be 1B–10MB');
    }
    const msg = await this.repo.findMessageById(messageId);
    if (!msg || msg.ticketId !== id) throw new NotFoundException('Message not found in ticket');
    const objectKey = `support/${id}/${randomUUID()}`;
    const uploadUrl = this.r2.presignedPutUrl(objectKey, b.fileType, 900);
    const row = await this.repo.addAttachment({
      messageId,
      fileUrl: this.r2.objectUrl(objectKey),
      fileType: b.fileType,
      fileSize: b.fileSize,
    });
    return { attachmentId: row.id, fileUrl: this.r2.objectUrl(objectKey), uploadUrl, expiresInSeconds: 900 };
  }

  // ===== Categories =====
  @Get('categories')
  @UseGuards(JwtAuthGuard, TenantGuard)
  categories() {
    return this.repo.findAllCategories();
  }

  // Agent dashboard
  @Get('agent/open-tickets')
  @UseGuards(JwtAuthGuard, TenantGuard)
  openTickets(@Req() req: LooseReq, @Query('limit') limit?: string) {
    const { role } = actorOf(req);
    assertAgent(role);
    return this.repo.findOpenTickets(limit ? Number(limit) : 50);
  }

  // SSE agent room for new ticket alerts
  @Sse('agent/room/stream')
  @UseGuards(JwtAuthGuard, TenantGuard)
  agentRoom(@Req() req: LooseReq, @Query('tenantId') tenantId?: string) {
    const { role, tenantId: actorTenant } = actorOf(req);
    assertAgent(role);
    const room = tenantId ?? actorTenant;
    return new Observable((subscriber) => {
      const release = this.gateway.subscribeAgent(room, {
        write: (chunk: string) => subscriber.next({ data: chunk }),
      });
      return release;
    });
  }
}
