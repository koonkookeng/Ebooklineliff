// SSOT Phase 131 §5.5 — Transactional email delivery (SMTP or HTTP API, zero new deps)
// Canonical: apps/backend/src/modules/auth/services/email-sender.service.ts
//
// Priority: SMTP_HOST > EMAIL_API_URL > development console fallback.
// Production refuses to silently drop mail when neither is configured.
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

interface SmtpReply {
  code: number;
  text: string;
}

const SMTP_TIMEOUT_MS = 15_000;

function stripHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function encodeHeader(value: string): string {
  const clean = stripHeader(value);
  return /^[\x20-\x7E]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function base64Lines(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');
}

class SmtpChannel {
  private buffer = '';
  private closed = false;

  constructor(
    private socket: net.Socket | tls.TLSSocket,
    private readonly host: string,
    private readonly rejectUnauthorized: boolean,
  ) {
    this.attach();
  }

  private attach(): void {
    this.socket.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
    });
    this.socket.on('close', () => {
      this.closed = true;
    });
    this.socket.on('error', () => {
      this.closed = true;
    });
  }

  async readReply(): Promise<SmtpReply> {
    const deadline = Date.now() + SMTP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const parsed = this.takeReply();
      if (parsed) return parsed;
      if (this.closed) throw new Error('SMTP connection closed');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('SMTP timeout');
  }

  private takeReply(): SmtpReply | null {
    // SMTP multiline replies use "250-...", terminated by "250 ...".
    const lines = this.buffer.split('\r\n');
    if (lines.length < 2) return null;
    let consumed = 0;
    let code = 0;
    const parts: string[] = [];
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      consumed += line.length + 2;
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) {
        this.buffer = this.buffer.slice(consumed);
        throw new Error(`Malformed SMTP reply: ${line.slice(0, 80)}`);
      }
      code = Number(match[1]);
      parts.push(match[3]);
      if (match[2] === ' ') {
        this.buffer = this.buffer.slice(consumed);
        return { code, text: parts.join('\n') };
      }
    }
    return null;
  }

  async command(line: string, expect: number[]): Promise<SmtpReply> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.readReply();
    if (!expect.includes(reply.code)) {
      throw new Error(`SMTP ${line.split(' ')[0]} failed (${reply.code})`);
    }
    return reply;
  }

  /** Raw DATA payload (already terminated by the caller with CRLF.CRLF). */
  writeData(payload: string): void {
    this.socket.write(payload);
  }

  async upgradeToTls(): Promise<void> {
    this.socket.removeAllListeners();
    const secureSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const socket = tls.connect(
        {
          socket: this.socket,
          servername: this.host,
          rejectUnauthorized: this.rejectUnauthorized,
        },
        () => resolve(socket),
      );
      socket.once('error', reject);
    });
    this.socket = secureSocket;
    this.buffer = '';
    this.closed = false;
    this.attach();
  }

  end(): void {
    try {
      this.socket.write('QUIT\r\n');
      this.socket.end();
    } catch {
      this.socket.destroy();
    }
  }
}

@Injectable()
export class EmailSenderService {
  private readonly logger = new Logger(EmailSenderService.name);
  private readonly smtpHost = process.env.SMTP_HOST ?? '';
  private readonly smtpPort = Number(process.env.SMTP_PORT ?? '587');
  private readonly smtpUser = process.env.SMTP_USER ?? '';
  private readonly smtpPass = process.env.SMTP_PASS ?? '';
  private readonly smtpSecure = process.env.SMTP_SECURE === 'true' || this.smtpPort === 465;
  private readonly smtpRejectUnauthorized =
    process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false';
  private readonly apiUrl = process.env.EMAIL_API_URL ?? '';
  private readonly apiKey = process.env.EMAIL_API_KEY ?? '';
  private readonly from = process.env.EMAIL_FROM ?? 'no-reply@ebook.local';
  private readonly fromName = process.env.EMAIL_FROM_NAME ?? 'Ebook Platform';

  async sendMail(email: OutboundEmail): Promise<void> {
    if (this.smtpHost) return this.sendViaSmtp(email);
    if (this.apiUrl) return this.sendViaApi(email);
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('Email delivery is not configured');
    }
    // Development fallback: never log in production.
    this.logger.log(`[dev-email] to=${email.to} subject="${email.subject}"\n${email.text}`);
  }

  async sendMagicLink(to: string, link: string, expiresInSec: number): Promise<void> {
    const minutes = Math.max(1, Math.round(expiresInSec / 60));
    const subject = 'Your sign-in link';
    const text = [
      'Use the link below to sign in to your account.',
      '',
      link,
      '',
      `This link expires in ${minutes} minutes and can be used once.`,
      'If you did not request it, you can safely ignore this email.',
    ].join('\n');
    const safeLink = link.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = [
      '<p>Use the button below to sign in to your account.</p>',
      `<p><a href="${safeLink}" rel="noopener noreferrer">Sign in</a></p>`,
      `<p>This link expires in ${minutes} minutes and can be used once.</p>`,
      '<p>If you did not request it, you can safely ignore this email.</p>',
    ].join('');
    await this.sendMail({ to, subject, text, html });
  }

  private async sendViaApi(email: OutboundEmail): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SMTP_TIMEOUT_MS);
    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          from: `${this.fromName} <${this.from}>`,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          html: email.html ?? email.text,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.error(`Email API rejected message (${res.status})`);
        throw new ServiceUnavailableException('Email delivery failed');
      }
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`Email API unreachable: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Email delivery failed');
    } finally {
      clearTimeout(timer);
    }
  }

  private async sendViaSmtp(email: OutboundEmail): Promise<void> {
    let channel: SmtpChannel | null = null;
    try {
      const socket = this.smtpSecure
        ? tls.connect({
            host: this.smtpHost,
            port: this.smtpPort,
            servername: this.smtpHost,
            rejectUnauthorized: this.smtpRejectUnauthorized,
          })
        : net.connect({ host: this.smtpHost, port: this.smtpPort });
      channel = new SmtpChannel(socket, this.smtpHost, this.smtpRejectUnauthorized);

      const greeting = await channel.readReply();
      if (greeting.code !== 220) throw new Error(`SMTP greeting ${greeting.code}`);

      const capabilities = await channel.command('EHLO localhost', [250]);
      if (!this.smtpSecure && /STARTTLS/i.test(capabilities.text)) {
        await channel.command('STARTTLS', [220]);
        await channel.upgradeToTls();
        await channel.command('EHLO localhost', [250]);
      }

      if (this.smtpUser) {
        const token = Buffer.from(`\0${this.smtpUser}\0${this.smtpPass}`, 'utf8').toString('base64');
        await channel.command(`AUTH PLAIN ${token}`, [235]);
      }

      await channel.command(`MAIL FROM:<${stripHeader(this.from)}>`, [250]);
      await channel.command(`RCPT TO:<${stripHeader(email.to)}>`, [250, 251]);
      await channel.command('DATA', [354]);
      channel.writeData(`${this.buildMime(email)}\r\n.\r\n`);
      const stored = await channel.readReply();
      if (stored.code !== 250) throw new Error(`SMTP DATA ${stored.code}`);
      channel.end();
    } catch (err) {
      channel?.end();
      this.logger.error(`SMTP delivery failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Email delivery failed');
    }
  }

  private buildMime(email: OutboundEmail): string {
    const boundary = `=_${randomUUID()}`;
    const headers = [
      `From: ${encodeHeader(this.fromName)} <${stripHeader(this.from)}>`,
      `To: <${stripHeader(email.to)}>`,
      `Subject: ${encodeHeader(email.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@${stripHeader(this.from).split('@')[1] ?? 'localhost'}>`,
      'MIME-Version: 1.0',
    ];
    if (!email.html) {
      return [
        ...headers,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(email.text),
      ].join('\r\n');
    }
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(email.text),
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(email.html),
      `--${boundary}--`,
    ].join('\r\n');
  }
}
