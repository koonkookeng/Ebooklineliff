// SSOT Phase 061 §6.1 — WebGL/2D tile deshuffler (dual engine)
// Canonical: apps/frontend/components/reader/webgl-deshuffler.ts
// (legacy src/frontend/components/reader/webgl-deshuffler.ts)
// - deshuffleCanvas2D: tile-copy unscramble (perm[src] → dest) + GC-safe.
// - tryDeshuffleWebGL: texture-tile shader pass with texture-reuse pool;
//   returns false on missing WebGL2/context-loss so callers fall back to 2D
//   (ERROR auto-recovery, §10). Textures evicted per turn (RAM <30MB).
// - Pure DOM/WebGL, framework-free. Zero new deps.
import { tileRects, type ShufflingMatrixSeed } from '@repo/shared';

/** 2D tile deshuffle: scrambled src tiles → true dest positions. */
export function deshuffleCanvas2D(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  matrix: ShufflingMatrixSeed,
): void {
  const { gridX, gridY, permutationArray } = matrix;
  const rects = tileRects(img.width, img.height, gridX, gridY);
  ctx.clearRect(0, 0, img.width, img.height);
  for (let srcIndex = 0; srcIndex < permutationArray.length; srcIndex++) {
    const destIndex = permutationArray[srcIndex];
    const src = rects[srcIndex];
    const dest = rects[destIndex];
    if (!src || !dest) continue;
    ctx.drawImage(img, src.x, src.y, src.w, src.h, dest.x, dest.y, dest.w, dest.h);
  }
}

const TILE_VS = `#version 300 es
in vec2 aPos; in vec2 aUv; out vec2 vUv;
void main(){ vUv = aUv; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const TILE_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex; uniform vec4 uSrc; uniform vec2 uTexSize;
in vec2 vUv; out vec4 oColor;
void main(){
  vec2 tileUv = (uSrc.xy + vUv * uSrc.zw) / uTexSize;
  oColor = texture(uTex, tileUv);
}`;

/**
 * WebGL2 tile deshuffle into an output canvas. Reuses one texture per call
 * and deletes it before returning (pool-of-one, no leak). Returns false when
 * WebGL2 is unavailable or the context is lost → caller uses 2D fallback.
 */
export function tryDeshuffleWebGL(
  outCanvas: HTMLCanvasElement,
  img: HTMLImageElement,
  matrix: ShufflingMatrixSeed,
): boolean {
  try {
    const gl = outCanvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
    if (!gl) return false;
    if (gl.isContextLost()) return false;
    const { gridX, gridY, permutationArray } = matrix;
    const rects = tileRects(img.width, img.height, gridX, gridY);
    outCanvas.width = img.width;
    outCanvas.height = img.height;
    gl.viewport(0, 0, img.width, img.height);

    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, TILE_VS);
    const fs = compile(gl.FRAGMENT_SHADER, TILE_FS);
    if (!vs || !fs) return false;
    const prog = gl.createProgram();
    if (!prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      return false;
    }
    gl.useProgram(prog);

    const tex = gl.createTexture();
    if (!tex) {
      gl.deleteProgram(prog);
      return false;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

    const quad = new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aUv = gl.getAttribLocation(prog, 'aUv');
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
    const uSrc = gl.getUniformLocation(prog, 'uSrc');
    const uTexSize = gl.getUniformLocation(prog, 'uTexSize');
    gl.uniform2f(uTexSize, img.width, img.height);

    for (let srcIndex = 0; srcIndex < permutationArray.length; srcIndex++) {
      const destIndex = permutationArray[srcIndex];
      const src = rects[srcIndex];
      const dest = rects[destIndex];
      if (!src || !dest) continue;
      gl.uniform4f(uSrc, src.x, img.height - src.y - src.h, src.w, src.h);
      gl.viewport(dest.x, img.height - dest.y - dest.h, Math.max(1, Math.round(dest.w)), Math.max(1, Math.round(dest.h)));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.deleteTexture(tex);
    gl.deleteBuffer(buf);
    gl.deleteProgram(prog);
    const err = gl.getError();
    return err === gl.NO_ERROR;
  } catch {
    return false;
  }
}
