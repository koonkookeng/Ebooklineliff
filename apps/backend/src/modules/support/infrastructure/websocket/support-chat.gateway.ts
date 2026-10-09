// SSOT Phase 103 Task 3 — Support Chat Gateway (SSE, not WS — zero-dep)
// Canonical: apps/backend/src/modules/support/infrastructure/websocket/support-chat.gateway.ts
// - SSE fan-out per ticket + agent room; handshake verifies 100 gatekeeper
//   token or user JWT. Agent escalation rides room channel.
// - RISK_CALL: SSE replaces spec's WS namespace (099/100 precedent).
//   Zero new deps.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ticketMessageStreamKey } from '@repo/shared';

export interface SupportSubscriber {
  write(chunk: string): void;
}

export interface SupportBus {
  xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

export interface SupportPubSub {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<() => void>;
}

export interface SupportTokenVerifier {
  verify(token: string): { userId: string; role: string } | null;
}

function agentRoomKey(tenantId: string): string {
  return `support:agent:${tenantId}`;
}

@Injectable()
export class SupportChatGateway implements OnModuleInit {
  private readonly subs = new Map<string, Set<SupportSubscriber>>();
  private attached = false;

  constructor(
    private readonly bus: SupportBus,
    private readonly pubsub: SupportPubSub,
    private readonly verifier: SupportTokenVerifier,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.attach();
  }

  async attach(): Promise<void> {
    if (this.attached) return;
    this.attached = true;
  }

  /** Handshake: supports both 100-gatekeeper token and user JWT. */
  handshake(ticketId: string, token: string): { userId: string; role: string } | null {
    if (!ticketId || !token) return null;
    const v = this.verifier.verify(token);
    if (!v) return null;
    return { userId: v.userId, role: v.role };
  }

  /** Subscribe a viewer to their ticket's message stream. */
  subscribe(ticketId: string, sub: SupportSubscriber): () => void {
    const key = ticketMessageStreamKey(ticketId);
    let set = this.subs.get(key);
    if (!set) {
      set = new Set();
      this.subs.set(key, set);
    }
    set.add(sub);
    return () => {
      set.delete(sub);
      if (set.size === 0) this.subs.delete(key);
    };
  }

  /** Subscribe an agent to the tenant's agent room for new-ticket alerts. */
  subscribeAgent(tenantId: string, sub: SupportSubscriber): () => void {
    const key = agentRoomKey(tenantId);
    let set = this.subs.get(key);
    if (!set) {
      set = new Set();
      this.subs.set(key, set);
    }
    set.add(sub);
    return () => {
      set.delete(sub);
      if (set.size === 0) this.subs.delete(key);
    };
  }

  private emit(key: string, event: string, payload: Record<string, unknown>): number {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    let n = 0;
    for (const sub of this.subs.get(key) ?? []) {
      try {
        sub.write(frame);
        n++;
      } catch {
        // drop on next cycle
      }
    }
    return n;
  }

  /** Broadcast a message to all subscribers of a ticket. */
  async broadcast(ticketId: string, event: string, payload: Record<string, unknown>): Promise<number> {
    const n = this.emit(ticketMessageStreamKey(ticketId), event, payload);
    await this.bus
      .xaddPipeline('support:ticket:events', [{ event, ticketId, payload: JSON.stringify(payload), at: Date.now() }])
      .catch(() => undefined);
    return n;
  }

  /** Agent emits new message to ticket stream. */
  async agentReply(args: { ticketId: string; agentId: string; message: string }): Promise<number> {
    const n = this.emit(ticketMessageStreamKey(args.ticketId), 'agent_message', {
      agentId: args.agentId,
      message: args.message,
    });
    await this.bus
      .xaddPipeline('support:ticket:events', [
        { event: 'agent_reply', ticketId: args.ticketId, agentId: args.agentId, at: Date.now() },
      ])
      .catch(() => undefined);
    return n;
  }

  /** Alert all agents in a tenant about a new ticket. */
  async alertAgents(
    tenantId: string,
    ticket: { id: string; ticketNo: string; subject: string; priority: string },
  ): Promise<number> {
    const n = this.emit(agentRoomKey(tenantId), 'new_ticket', ticket);
    await this.bus
      .xaddPipeline('support:ticket:events', [
        { event: 'new_ticket', ticketId: ticket.id, payload: JSON.stringify(ticket), at: Date.now() },
      ])
      .catch(() => undefined);
    return n;
  }
}
