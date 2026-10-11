// SSOT Phase 007 §5.2 — legacy IN_SCOPE alias (spec path src/backend/modules/auth/gateways/qr-auth.gateway.ts).
// Canonical implementation lives at ../qr-sync/infrastructure/gateways/qr-auth.gateway.ts
// (SSE+Redis fan-out, zero socket.io deps per ADR-007). This alias keeps the spec-listed
// import path valid without duplicating logic.
export { QrAuthGateway } from '../qr-sync/infrastructure/gateways/qr-auth.gateway';
