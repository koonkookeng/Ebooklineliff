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
    # Phase 006 §3.2 — full auth profile for the verified session owner
    authMe: UserAuthPayload!
    # Phase 007 §3.2 — request dynamic QR session credentials (tenantId falls back to x-tenant-id)
    initQrLoginSession(tenantId: ID): QrSessionPayload!
  }

  type MePayload {
    id: ID!
    displayName: String!
  }

  type Mutation {
    # Intent: Authenticate via LINE LIFF One-Click Access (accessToken = deprecated Phase 004 alias of idToken;
    # input = Phase 006 object form for Mini App clients; both route to the same atomic engine)
    authenticateLineLiff(idToken: String, accessToken: String, tenantId: ID!, referralCode: String, input: LiffAuthInput): AuthPayload!
    # Intent: Authenticate via Web OAuth 2.1 (LINE / Google)
    authenticateWebOAuth(provider: AuthProvider!, code: String!, state: String!, redirectUri: String!, tenantId: ID!): AuthPayload!
    # Intent: Refresh Access Token with Rotatable Refresh Token (refresh token via __Host cookie)
    refreshAccessToken: AuthPayload!
    # Intent: Logout and Invalidate Active Session (logout = Phase 006 alias)
    logoutSession: Boolean!
    logout: Boolean!
    # Phase 007 §3.2 — authorize / reject a desktop QR login from an authenticated LIFF session
    confirmQrSessionAuth(input: ConfirmQrAuthInput!): QrAuthResultPayload!
    rejectQrSessionAuth(qrToken: String!): Boolean!
    createOrder(productIds: [ID!]!): OrderPayload!
  }

  # Phase 007 §3.2 — QR cross-platform login sync intents
  type QrSessionPayload {
    qrToken: String!
    encryptedNonce: String!
    expiresInSec: Int!
    websocketChannel: String!
  }

  type QrAuthResultPayload {
    success: Boolean!
    authorizedAt: String!
    deviceInfo: String!
  }

  input ConfirmQrAuthInput {
    qrToken: String!
    deviceFingerprint: String!
  }

  type AuthUser {
    id: ID!
    displayName: String!
    avatarUrl: String
    email: String
    lineUserId: String
    role: String!
    tenantId: ID!
    # Phase 006 enrichment (same User row)
    walletBalance: Float
    rewardPoints: Int
    affiliateCode: String
  }

  # Phase 006 §3.2 — LIFF seamless-auth intent layer (canonical shape for Mini App clients)
  input LiffAuthInput {
    idToken: String!
    tenantId: ID!
    referralCode: String
  }

  type UserAuthPayload {
    id: ID!
    lineUserId: String!
    displayName: String!
    avatarUrl: String
    email: String
    role: String!
    tenantId: ID!
    walletBalance: Float!
    rewardPoints: Int!
    affiliateCode: String!
  }

  type AuthTokenResponse {
    accessToken: String!
    expiresIn: Int!
    user: UserAuthPayload!
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
