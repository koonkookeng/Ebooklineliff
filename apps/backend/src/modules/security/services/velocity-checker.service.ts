// SSOT Phase 120 Task 4 §7.1 — Haversine velocity checker (pure core)
// Canonical: apps/backend/src/modules/security/services/velocity-checker.service.ts
// (legacy src/backend/modules/security/services/velocity-checker.service.ts)
// - calculateVelocity(last, current, now): distance/time/speed + impossible
//   verdict at >800 km/h (BDD boundary: 799 glides, 801 trips).
// - rotationScreen: 10 distinct IPs in 30s from timestamp lists (BDD-2).
// - Pure + injectable shell (DB-free tests). Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  GEO_MATCH_TOLERANCE_MINS,
  VELOCITY_ROTATION_COUNT,
  VELOCITY_ROTATION_WINDOW_SEC,
  haversineKm,
  isImpossibleTravel,
  travelSpeedKmh,
} from '@repo/shared';

export interface VelocityVerdict {
  distanceKm: number;
  minutes: number;
  speedKmh: number;
  impossible: boolean;
}

export interface RotationVerdict {
  tripped: boolean;
  distinctIps: number;
}

/** Velocity between two fixes (null last fix → zeroed verdict). */
export function calculateVelocity(
  last: { latitude: number | null; longitude: number | null; at: Date | string } | null,
  current: { latitude: number; longitude: number },
  nowMs: number,
): VelocityVerdict {
  if (!last || last.latitude === null || last.longitude === null) {
    return { distanceKm: 0, minutes: 0, speedKmh: 0, impossible: false };
  }
  const distanceKm = Math.round(haversineKm(last.latitude, last.longitude, current.latitude, current.longitude) * 100) / 100;
  const minutes = Math.max(0, Math.round(((nowMs - new Date(last.at).getTime()) / 60000) * 100) / 100);
  const speedKmh = Math.round(travelSpeedKmh(distanceKm, minutes) * 100) / 100;
  return { distanceKm, minutes, speedKmh, impossible: isImpossibleTravel(speedKmh) };
}

/** Sliding-window rotation screen over login timestamps. */
export function rotationScreen(
  attempts: Array<{ ip: string; at: number }>,
  nowMs: number,
  count = VELOCITY_ROTATION_COUNT,
  windowSec = VELOCITY_ROTATION_WINDOW_SEC,
): RotationVerdict {
  const floor = nowMs - windowSec * 1000;
  const distinct = new Set(attempts.filter((a) => a.at >= floor).map((a) => a.ip));
  return { tripped: distinct.size >= count, distinctIps: distinct.size };
}

/** Tolerance-window matcher for statement/order clocks (15m default). */
export function withinTolerance(a: Date | string, b: Date | string, mins = GEO_MATCH_TOLERANCE_MINS): boolean {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= mins * 60000;
}

@Injectable()
export class VelocityCheckerService {
  calculate = calculateVelocity;
  rotation = rotationScreen;
  tolerance = withinTolerance;
}
