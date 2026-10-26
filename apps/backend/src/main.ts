// SSOT Phase 001 §5.2 — Fastify core bootstrap
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppConfigSchema } from '@repo/shared';
import { R2_CORS_RULES } from './infra/security/cloudflare-cors.config';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';

const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';

/** §8.2: browser CORS is the LINE LIFF + official web origins only. */
function allowedOrigins(): Set<string> {
  const extra = (process.env['CORS_ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return new Set([...R2_CORS_RULES[0].AllowedOrigins, ...extra]);
}

async function bootstrap() {
  const logger = new Logger('NestJS-Fastify-Core');
  // Phase 121 Task 1: bootstrap-owned OTel init (fail-open, idempotent).
  try {
    const { initTelemetry } = await import('./infra/observability/open-telemetry.sdk');
    await initTelemetry('ebook-liff-backend', process.env['NODE_ENV'] ?? 'development');
  } catch (err) {
    logger.warn(`Telemetry bootstrap fail-open: ${(err as Error).message}`);
  }
  const envConfig = AppConfigSchema.parse(process.env);
  const adapter = new FastifyAdapter({ logger: false, trustProxy: true });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);
  await app.register(helmet, { contentSecurityPolicy: false });
  const origins = allowedOrigins();
  await app.register(cors, {
    credentials: true,
    // Never reflect arbitrary origins with credentials (the previous
    // `origin: true` let any site read authenticated responses). Requests
    // without Origin (server-to-server, webhooks, health) stay allowed.
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origins.has(origin)) return cb(null, true);
      if (!IS_PRODUCTION && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
      cb(new Error('CORS origin denied'), false);
    },
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.setGlobalPrefix('api/v1');
  await app.listen(envConfig.PORT, '0.0.0.0');
  logger.log(`Monorepo Backend Core running on: http://localhost:${envConfig.PORT}/api/v1`);
}

bootstrap();
