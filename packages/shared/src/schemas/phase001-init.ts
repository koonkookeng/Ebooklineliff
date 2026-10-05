// SSOT Phase 001 §3.1 — Unified Zod Domain Contract
import { z } from 'zod';

export const NodeEnvEnum = z.enum(['development', 'production', 'test', 'staging']);

export const AppConfigSchema = z.object({
  NODE_ENV: NodeEnvEnum.default('development'),
  PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
});

export const HealthCheckResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string().datetime(),
  uptime: z.number(),
  engine: z.literal('Fastify Engine'),
  version: z.string(),
  tenantContext: z.string().optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;
