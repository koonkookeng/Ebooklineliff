// SSOT Phase 049 §6.2 — Pixel Unshuffle Web Worker (descramble + LSB embed)
// Canonical: apps/frontend/workers/pixel-unshuffle.worker.ts
// (legacy src/frontend/workers/pixel-unshuffle.worker.ts)
// - Single engine for tile descramble: OffscreenCanvas + shared SSOT math
//   (invertPermutation / embedLsb from @repo/shared — no duplicated logic).
// - Module also exports pure functions so tsx contract tests can verify the
//   math without a DOM/Worker runtime.
// - Memory discipline: transferables only, caller closes bitmaps, revoke
//   Blob URLs immediately (RAM <30MB, 60 FPS budget).
import { embedLsb } from '@repo/shared';

export interface UnshuffleInput {
  /** Scrambled tile order: tileIndex[scrambledPosition] = rgba offset group. */
  scrambledRgba: Uint8Array;
  tileWidth: number;
  tileHeight: number;
  gridCols: number;
  gridRows: number;
  /** scrambledIndex -> originalIndex (spec §6.2 convention). */
  permutationVector: number[];
  viewportWidth: number;
  viewportHeight: number;
  forensicPayload: string;
}

export interface UnshuffleResult {
  status: 'SUCCESS' | 'ERROR';
  rgba?: Uint8Array;
  error?: string;
  elapsedMs: number;
}

/**
 * Pure descramble: copy each 64px tile from its scrambled position back to
 * its original position, then embed the LSB forensic payload.
 */
export function descrambleTiles(input: UnshuffleInput): UnshuffleResult {
  const started = Date.now();
  try {
    const { tileWidth, tileHeight, gridCols, gridRows, permutationVector } = input;
    if (gridCols * gridRows !== permutationVector.length) {
      return { status: 'ERROR', error: 'matrix dimensions mismatch', elapsedMs: Date.now() - started };
    }
    const out = new Uint8Array(input.scrambledRgba.length);
    const rowBytes = input.viewportWidth * 4;
    const tileBytes = tileWidth * 4;

    for (let scrambled = 0; scrambled < permutationVector.length; scrambled++) {
      const original = permutationVector[scrambled];
      const srcCol = scrambled % gridCols;
      const srcRow = Math.floor(scrambled / gridCols);
      const dstCol = original % gridCols;
      const dstRow = Math.floor(original / gridCols);
      for (let y = 0; y < tileHeight; y++) {
        const srcY = srcRow * tileHeight + y;
        const dstY = dstRow * tileHeight + y;
        if (srcY >= input.viewportHeight || dstY >= input.viewportHeight) continue;
        const srcOff = srcY * rowBytes + srcCol * tileBytes;
        const dstOff = dstY * rowBytes + dstCol * tileBytes;
        out.set(input.scrambledRgba.subarray(srcOff, srcOff + tileBytes), dstOff);
      }
    }

    // LSB forensic embed via the shared SSOT engine (single implementation).
    embedLsb(out, input.forensicPayload);
    return { status: 'SUCCESS', rgba: out, elapsedMs: Date.now() - started };
  } catch (err) {
    return {
      status: 'ERROR',
      error: err instanceof Error ? err.message : 'descramble failed',
      elapsedMs: Date.now() - started,
    };
  }
}

/** Inverse helper for tests: scramble an ordered buffer with a permutation. */
export function scrambleTiles(
  ordered: Uint8Array,
  tileWidth: number,
  tileHeight: number,
  gridCols: number,
  gridRows: number,
  permutationVector: number[],
  viewportWidth: number,
  viewportHeight: number,
): Uint8Array {
  const out = new Uint8Array(ordered.length);
  const rowBytes = viewportWidth * 4;
  const tileBytes = tileWidth * 4;
  for (let scrambled = 0; scrambled < permutationVector.length; scrambled++) {
    const original = permutationVector[scrambled];
    const srcCol = original % gridCols;
    const srcRow = Math.floor(original / gridCols);
    const dstCol = scrambled % gridCols;
    const dstRow = Math.floor(scrambled / gridCols);
    for (let y = 0; y < tileHeight; y++) {
      const srcY = srcRow * tileHeight + y;
      const dstY = dstRow * tileHeight + y;
      if (srcY >= viewportHeight || dstY >= viewportHeight) continue;
      const srcOff = srcY * rowBytes + srcCol * tileBytes;
      const dstOff = dstY * rowBytes + dstCol * tileBytes;
      out.set(ordered.subarray(srcOff, srcOff + tileBytes), dstOff);
    }
  }
  void gridRows;
  return out;
}

// Worker runtime wiring (browser only; no-op under tsx/node).
declare const self: {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
} | undefined;
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (e: MessageEvent) => {
    const data = e.data as {
      scrambled: ArrayBuffer;
      tileMatrix: {
        tileWidth: number;
        tileHeight: number;
        gridCols: number;
        gridRows: number;
        permutationVector: number[];
      };
      viewportWidth: number;
      viewportHeight: number;
      forensicPayload: string;
    };
    const result = descrambleTiles({
      scrambledRgba: new Uint8Array(data.scrambled),
      tileWidth: data.tileMatrix.tileWidth,
      tileHeight: data.tileMatrix.tileHeight,
      gridCols: data.tileMatrix.gridCols,
      gridRows: data.tileMatrix.gridRows,
      permutationVector: data.tileMatrix.permutationVector,
      viewportWidth: data.viewportWidth,
      viewportHeight: data.viewportHeight,
      forensicPayload: data.forensicPayload,
    });
    if (result.status === 'SUCCESS' && result.rgba) {
      self.postMessage({ status: 'SUCCESS', rgba: result.rgba.buffer }, [result.rgba.buffer]);
    } else {
      self.postMessage({ status: 'ERROR', error: result.error ?? 'unknown' });
    }
  };
}
