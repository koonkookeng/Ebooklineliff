// SSOT Phase 004 §5.2 — GraphQL context factory (tenant propagation)
export interface GraphQLContext {
  headers: Record<string, unknown>;
  user?: { id: string; displayName?: string; lineUserId?: string };
  tenantId: string;
}

export function buildGraphQLContext({
  req,
}: {
  req: { headers: Record<string, string | undefined>; user?: GraphQLContext['user'] };
}): GraphQLContext {
  return {
    headers: req.headers,
    user: req.user,
    tenantId: req.headers['x-tenant-id'] ?? 'default',
  };
}
