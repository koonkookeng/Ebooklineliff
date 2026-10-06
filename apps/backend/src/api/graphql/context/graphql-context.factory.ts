// SSOT Phase 004 §5.2 + Phase 005 §5.1 — GraphQL context factory (tenant propagation + auth req passthrough)
export interface GraphQLRequest {
  headers: Record<string, string | undefined>;
  ip?: string;
  cookies?: Record<string, string | undefined>;
  user?: { id: string; displayName?: string; lineUserId?: string; sessionId?: string; role?: string; tenantId?: string };
}

export interface GraphQLContext {
  headers: Record<string, unknown>;
  user?: GraphQLRequest['user'];
  tenantId: string;
  req: GraphQLRequest;
}

export function buildGraphQLContext({ req }: { req: GraphQLRequest }): GraphQLContext {
  return {
    headers: req.headers,
    user: req.user,
    tenantId: req.headers['x-tenant-id'] ?? 'default',
    req,
  };
}
