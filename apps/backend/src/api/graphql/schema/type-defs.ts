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
    # Intent: Authenticate via LINE LIFF One-Click Access (accessToken = deprecated Phase 004 alias of idToken)
    authenticateLineLiff(idToken: String, accessToken: String, tenantId: ID!, referralCode: String): AuthPayload!
    # Intent: Authenticate via Web OAuth 2.1 (LINE / Google)
    authenticateWebOAuth(provider: AuthProvider!, code: String!, state: String!, redirectUri: String!, tenantId: ID!): AuthPayload!
    # Intent: Refresh Access Token with Rotatable Refresh Token (refresh token via __Host cookie)
    refreshAccessToken: AuthPayload!
    # Intent: Logout and Invalidate Active Session
    logoutSession: Boolean!
    createOrder(productIds: [ID!]!): OrderPayload!
  }

  type AuthUser {
    id: ID!
    displayName: String!
    avatarUrl: String
    email: String
    lineUserId: String
    role: String!
    tenantId: ID!
  }

  type AuthPayload {
    accessToken: String!
    expiresIn: Int!
    user: AuthUser!
    token: String @deprecated(reason: "Use accessToken (Phase 005 unified contract)")
    userId: ID @deprecated(reason: "Use user.id (Phase 005 unified contract)")
  }

  enum AuthProvider {
    LINE_LIFF
    LINE_WEB
    GOOGLE
    EMAIL_PASSWORD
    REFRESH_TOKEN
  }
`;
