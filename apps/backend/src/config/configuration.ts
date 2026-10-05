// SSOT Phase 001 §5 — typed env access
import { AppConfigSchema, type AppConfig } from '@repo/shared';

export function getConfiguration(): AppConfig {
  return AppConfigSchema.parse(process.env);
}

export default getConfiguration;
