// SSOT Phase 032 §3.1 — Reverse geocode DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/permission/dto/reverse-geocode.dto.ts
// (legacy src/backend/modules/permission/dto/reverse-geocode.dto.ts)
// - Single source: packages/shared/src/schemas/permission-contract.ts (no forked shapes).
import { GeolocationCoordinatesSchema, ReverseGeocodeResultSchema } from '@repo/shared';
import type { GeolocationCoordinates, ReverseGeocodeResult } from '@repo/shared';

export { GeolocationCoordinatesSchema, ReverseGeocodeResultSchema };
export type ReverseGeocodeDto = GeolocationCoordinates;
export type ReverseGeocodeResponseDto = ReverseGeocodeResult;
