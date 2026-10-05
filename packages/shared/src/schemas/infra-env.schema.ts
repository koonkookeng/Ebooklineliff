// SSOT Phase 002 §3 — Zod environment schema for infrastructure
import { z } from 'zod';

export const InfrastructureEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),

  // PostgreSQL configurations
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(8),
  DATABASE_URL: z.string().url(),

  // Redis cluster configurations
  REDIS_CLUSTER_NODES: z.string().min(1), // e.g. "redis-node-1:6379,redis-node-2:6379,redis-node-3:6379"
  REDIS_PASSWORD: z.string().min(8),

  // Cloudflare R2 storage configurations
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  R2_PUBLIC_DOMAIN: z.string().url(),

  // Connection pool optimizations
  DATABASE_POOL_MIN: z.coerce.number().default(10),
  DATABASE_POOL_MAX: z.coerce.number().default(100),
});

export type InfrastructureEnv = z.infer<typeof InfrastructureEnvSchema>;
