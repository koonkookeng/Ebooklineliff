// SSOT Phase 004 §5.2 — Apollo gateway module (Fastify core)
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { AuthResolver } from '../../api/graphql/resolvers/auth.resolver';
import { EbookReaderResolver } from '../../api/graphql/resolvers/ebook-reader.resolver';
import { ElearningResolver } from '../../api/graphql/resolvers/elearning.resolver';
import { OrderPaymentResolver } from '../../api/graphql/resolvers/order-payment.resolver';
import { IdentityModule } from '../../modules/identity/identity.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { QrAuthResolver } from '../../modules/auth/qr-sync/presentation/resolvers/qr-auth.resolver';
import { buildGraphQLContext } from '../../api/graphql/context/graphql-context.factory';

@Module({
  imports: [
    IdentityModule,
    AuthModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      playground: process.env.NODE_ENV !== 'production',
      introspection: true,
      context: ({ req }: { req: { headers: Record<string, string | undefined>; user?: { id: string } } }) =>
        buildGraphQLContext({ req }),
    }),
  ],
  providers: [AuthResolver, EbookReaderResolver, ElearningResolver, OrderPaymentResolver, QrAuthResolver],
})
export class ApolloServerGatewayModule {}
