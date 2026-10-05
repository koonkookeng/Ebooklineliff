// SSOT Phase 004 §6.1 — Apollo Client for Next.js 15 LIFF (tenant + JWT headers)
import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';

declare global {
  interface Window {
    __TENANT_ID__?: string;
  }
}

const httpLink = createHttpLink({
  uri: process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT || '/graphql',
});

const authLink = setContext((_, { headers }) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('liff_jwt_token') : '';
  const tenantId =
    typeof window !== 'undefined' ? window.__TENANT_ID__ || 'default' : 'default';

  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : '',
      'x-tenant-id': tenantId,
    },
  };
});

export const apolloClient = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache(),
});
