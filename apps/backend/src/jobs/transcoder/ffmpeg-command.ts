// SSOT Phase 043 Task 4 — FFmpeg command builder (pure, auditable)
// Canonical: apps/backend/src/jobs/transcoder/ffmpeg-command.ts
// (legacy src/backend/jobs/transcoder/ffmpeg-command.ts)
// - Builds the §5.3 multi-bitrate HLS command from VIDEO_RENDITION_LADDER
//   (verified against the spec bitrates in contract tests). Shell-escapes
//   every interpolated path (no injection from file names).
// - The binary never runs in tests: execution is injected at the processor.
// - Pure + tsx-safe. Zero new deps.
import { VIDEO_RENDITION_LADDER, type VideoResolution } from '@repo/shared';

export interface FfmpegPlan {
  command: string;
  variantCount: number;
}

function shellEscape(arg: string): string {
  if (/^[A-Za-z0-9_:\-/.,]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Spec §5.3 command for the requested ladder subset (order preserved). */
export function buildFfmpegCommand(input: {
  inputPath: string;
  outputDir: string;
  keyinfoPath?: string;
  resolutions: VideoResolution[];
  segmentSeconds?: number;
}): FfmpegPlan {
  const ladder = VIDEO_RENDITION_LADDER.filter((r) => input.resolutions.includes(r.resolution));
  if (ladder.length === 0) throw new Error('No renditions selected');
  const seg = input.segmentSeconds ?? 6;
  const splits = ladder.map((_, i) => `[v${i + 1}]`).join('');
  const scales = ladder.map((r, i) => `[v${i + 1}]scale=w=${r.width}:h=${r.height}[v${i + 1}out]`).join('; ');
  const maps = ladder
    .map((r, i) => {
      const maxrate = Math.round(r.bitrateBps * 1.06);
      const bufsize = Math.round(r.bitrateBps * 1.5);
      return `-map "[v${i + 1}out]" -c:v:${i} libx264 -b:v:${i} ${r.bitrateBps} -maxrate:v:${i} ${maxrate} -bufsize:v:${i} ${bufsize} -map a:0? -c:a:${i} aac -b:a:${i} ${r.audioBps}`;
    })
    .join(' ');
  const varMap = ladder.map((_, i) => `v:${i},a:${i}`).join(' ');
  const keyinfo = input.keyinfoPath ? ` -hls_key_info_file ${shellEscape(input.keyinfoPath)}` : '';
  const command = [
    'ffmpeg',
    `-i ${shellEscape(input.inputPath)}`,
    `-filter_complex "[0:v]split=${ladder.length}${splits}; ${scales}"`,
    maps,
    '-f hls',
    `-hls_time ${seg}`,
    '-hls_playlist_type vod',
    keyinfo.trim(),
    `-hls_segment_filename "${input.outputDir}/%v/seg_%03d.ts"`,
    '-master_pl_name master.m3u8',
    `-var_stream_map "${varMap}"`,
    `${input.outputDir}/%v/prog_index.m3u8`,
  ]
    .filter(Boolean)
    .join(' ');
  return { command, variantCount: ladder.length };
}
