import { Type } from "@sinclair/typebox";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveOutputRoot } from "../utils/project.js";

const execFileAsync = promisify(execFile);

const VideoComposeSchema = Type.Object({
  project_id: Type.String({ description: "Project ID (video_id)." }),
  clips: Type.Array(Type.String(), { description: "Video clip file paths, in order." }),
  bgm_path: Type.Optional(Type.String({ description: "BGM file path (optional)." })),
  bgm_volume: Type.Optional(Type.Number({ description: "BGM volume 0.0-1.0. Default 0.3." })),
  transition: Type.Optional(Type.String({ description: '"none" or "crossfade". Default "crossfade".' })),
  crossfade_duration: Type.Optional(Type.Number({ description: "Crossfade duration in seconds. Default 0.5." })),
});

/** Check that ffmpeg is available on the system. */
async function ensureFfmpeg(): Promise<void> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
  } catch {
    throw new Error("ffmpeg is not installed. Please install ffmpeg to use video_compose.");
  }
}

export function createVideoComposeTool(opts: { outputRoot?: string }) {
  return {
    label: "Video Compose",
    name: "video_compose",
    description:
      "Compose video clips + BGM into a final video using ffmpeg. Returns MEDIA:<path> for delivery.",
    parameters: VideoComposeSchema,
    execute: async (_toolCallId: string, args: unknown) => {
      await ensureFfmpeg();

      const params = args as Record<string, unknown>;
      const projectId = params.project_id as string;
      const clips = params.clips as string[];
      const bgmPath = params.bgm_path as string | undefined;
      const bgmVolume = (params.bgm_volume as number) ?? 0.3;
      const transition = (params.transition as string) ?? "crossfade";
      const crossfadeDuration = (params.crossfade_duration as number) ?? 0.5;

      // Validate all clips exist
      for (const clip of clips) {
        try {
          await fs.access(clip);
        } catch {
          throw new Error(`Clip not found: ${clip}`);
        }
      }

      const root = resolveOutputRoot(opts.outputRoot);
      const projectDir = path.join(root, "projects", projectId);
      await fs.mkdir(projectDir, { recursive: true });
      const outputPath = path.join(projectDir, "output.mp4");

      if (transition === "crossfade" && clips.length > 1) {
        await composeCrossfade(clips, outputPath, crossfadeDuration);
      } else {
        await composeConcat(clips, projectDir, outputPath);
      }

      // Mix BGM if provided
      if (bgmPath) {
        const withBgm = path.join(projectDir, "output_bgm.mp4");
        await mixBgm(outputPath, bgmPath, withBgm, bgmVolume);
        await fs.rename(withBgm, outputPath);
      }

      return {
        content: [{ type: "text", text: `MEDIA:${outputPath}` }],
        details: { outputPath, projectId },
      };
    },
  };
}

/** Simple concat using ffmpeg concat demuxer. */
async function composeConcat(
  clips: string[],
  projectDir: string,
  outputPath: string,
): Promise<void> {
  const listPath = path.join(projectDir, "concat.txt");
  const lines = clips.map((c) => `file '${c}'`).join("\n");
  await fs.writeFile(listPath, lines);

  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c", "copy",
    outputPath,
  ]);
}

/** Crossfade transition between clips using ffmpeg xfade filter. */
async function composeCrossfade(
  clips: string[],
  outputPath: string,
  fadeDuration: number,
): Promise<void> {
  if (clips.length === 1) {
    await fs.copyFile(clips[0], outputPath);
    return;
  }

  // Build xfade filter chain for sequential crossfades
  const inputs: string[] = [];
  const filterParts: string[] = [];

  for (const clip of clips) {
    inputs.push("-i", clip);
  }

  // Chain xfade filters: [0][1]xfade -> [v1], [v1][2]xfade -> [v2], ...
  let prevLabel = "[0:v]";
  for (let i = 1; i < clips.length; i++) {
    const outLabel = i < clips.length - 1 ? `[v${i}]` : "";
    // offset = approximate cumulative duration minus fade overlaps
    // We use a simple heuristic; for precise control, probe each clip duration.
    filterParts.push(
      `${prevLabel}[${i}:v]xfade=transition=fade:duration=${fadeDuration}:offset=${i * 4}${outLabel}`,
    );
    prevLabel = `[v${i}]`;
  }

  const filterComplex = filterParts.join(";");

  await execFileAsync("ffmpeg", [
    "-y",
    ...inputs,
    "-filter_complex", filterComplex,
    "-c:v", "libx264",
    "-preset", "fast",
    outputPath,
  ]);
}

/** Mix BGM audio track into the video. */
async function mixBgm(
  videoPath: string,
  bgmPath: string,
  outputPath: string,
  volume: number,
): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-i", bgmPath,
    "-filter_complex",
    `[1:a]volume=${volume}[bgm];[0:a][bgm]amix=inputs=2:duration=first[aout]`,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-shortest",
    outputPath,
  ]);
}
