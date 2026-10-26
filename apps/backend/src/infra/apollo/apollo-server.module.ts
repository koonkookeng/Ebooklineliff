// SSOT Phase 004 §5.2 — Apollo gateway module (Fastify core)
// Phase 130 §8.2: production introspection off + 100 req/min per-IP GraphQL
// budget (APP_GUARD here applies app-wide; the guard no-ops for HTTP).
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { AuthResolver } from '../../api/graphql/resolvers/auth.resolver';
import { EbookReaderResolver } from '../../api/graphql/resolvers/ebook-reader.resolver';
import { ElearningResolver } from '../../api/graphql/resolvers/elearning.resolver';
import { OrderPaymentResolver } from '../../api/graphql/resolvers/order-payment.resolver';
import { IdentityModule } from '../../modules/identity/identity.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { QrAuthResolver } from '../../modules/auth/qr-sync/presentation/resolvers/qr-auth.resolver';
import { GraphqlRateLimitGuard } from '../../modules/security/guards/graphql-rate-limit.guard';
import { RedisClusterService } from '../redis/redis-cluster.service';
import { buildGraphQLContext } from '../../api/graphql/context/graphql-context.factory';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    IdentityModule,
    AuthModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      playground: !IS_PRODUCTION,
      // Schema disclosure is an OWASP A05 reconnaissance vector; production
      // keeps introspection closed (codegen runs against staging).
      introspection: !IS_PRODUCTION,
      context: ({ req }: { req: { headers: Record<string, string | undefined>; user?: { id: string } } }) =>
        buildGraphQLContext({ req }),
    }),
  ],
  providers: [
    AuthResolver,
    EbookReaderResolver,
    ElearningResolver,
    OrderPaymentResolver,
    QrAuthResolver,
    {
      provide: APP_GUARD,
      useFactory: (redis: RedisClusterService) => new GraphqlRateLimitGuard(redis),
      inject: [RedisClusterService],
    },
  ],
})
export class ApolloServerGatewayModule {}
