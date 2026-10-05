// SSOT Phase 001 §5.2 — Fastify core bootstrap
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppConfigSchema } from '@repo/shared';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';

async function bootstrap() {
  const logger = new Logger('NestJS-Fastify-Core');
  const envConfig = AppConfigSchema.parse(process.env);
  const adapter = new FastifyAdapter({ logger: false, trustProxy: true });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.setGlobalPrefix('api/v1');
  await app.listen(envConfig.PORT, '0.0.0.0');
  logger.log(`Monorepo Backend Core running on: http://localhost:${envConfig.PORT}/api/v1`);
}

bootstrap();
