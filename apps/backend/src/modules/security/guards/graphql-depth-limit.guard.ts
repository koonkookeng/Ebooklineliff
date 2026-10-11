// SSOT Phase 127 §6.1 — GraphQL depth & complexity guard (OWASP A05:2021 DoS)
// Canonical: apps/backend/src/modules/security/guards/graphql-depth-limit.guard.ts
// (legacy src/backend/modules/security/guards/graphql-depth-limit.guard.ts)
// - Spec-verbatim: MAX_QUERY_DEPTH = 6; over-depth => ForbiddenException
//   ("Possible DoS attack blocked"). Pure calculateDepth exported for
//   contract tests (no Nest runtime needed).
// - RISK_CALL: class is GraphQLSecurityGuard per spec §6.1 (scaffold stub
//   name kept as compat alias — no importers of the stub exist).
// - Zero new deps (graphql is a workspace dep).
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { FieldNode, OperationDefinitionNode, parse } from 'graphql';
import { GQL_MAX_DEPTH } from '@repo/shared';

export function calculateDepth(
  node: FieldNode | OperationDefinitionNode,
  currentDepth = 0,
): number {
  if (!node.selectionSet) return currentDepth;
  let maxDepth = currentDepth;
  for (const selection of node.selectionSet.selections) {
    if (selection.kind === 'Field') {
      const depth = calculateDepth(selection as FieldNode, currentDepth + 1);
      if (depth > maxDepth) maxDepth = depth;
    }
  }
  return maxDepth;
}

export function depthOfQuery(query: string): number {
  const documentAST = parse(query);
  const first = documentAST.definitions.find(
    (d): d is OperationDefinitionNode => d.kind === 'OperationDefinition',
  );
  if (!first) return 0;
  return calculateDepth(first);
}

@Injectable()
export class GraphQLSecurityGuard implements CanActivate {
  private readonly MAX_QUERY_DEPTH = GQL_MAX_DEPTH;

  canActivate(context: ExecutionContext): boolean {
    const ctx = GqlExecutionContext.create(context);
    const args = ctx.getArgs() as { query?: unknown };
    const { query } = args;
    if (typeof query === 'string' && query.length > 0) {
      const depth = depthOfQuery(query);
      if (depth > this.MAX_QUERY_DEPTH) {
        throw new ForbiddenException(
          `Query depth exceeds maximum allowed limit of ${this.MAX_QUERY_DEPTH}. Possible DoS attack blocked.`,
        );
      }
    }
    return true;
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const GraphqlDepthLimitGuardGuard = GraphQLSecurityGuard;
