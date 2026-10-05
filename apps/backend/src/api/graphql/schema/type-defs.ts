// SSOT Phase 004 §5.2 — shared GraphQL type definitions (code-first SDL supplement)
export const typeDefs = /* GraphQL */ `
  type EbookChunkPayload {
    pageNumber: Int!
    vectorSvgContent: String!
    watermarkText: String!
    userIdHash: String!
    timestamp: String!
    hasPrevious: Boolean!
    hasNext: Boolean!
  }

  type OrderPayload {
    orderId: ID!
    orderNumber: String!
    netAmount: Float!
    orderStatus: String!
  }

  type Query {
    getEbookPageChunk(productId: ID!, pageNumber: Int!): EbookChunkPayload!
    me: MePayload!
  }

  type MePayload {
    id: ID!
    displayName: String!
  }

  type Mutation {
    authenticateLineLiff(accessToken: String!, tenantId: ID!): AuthPayload!
    createOrder(productIds: [ID!]!): OrderPayload!
  }

  type AuthPayload {
    token: String!
    userId: ID!
  }
`;
