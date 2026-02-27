import { Type } from "@sinclair/typebox";
import path from "node:path";
import fs from "node:fs/promises";
import { generateVideo } from "../api/kie-sora2.js";
import { resolveOutputRoot } from "../utils/project.js";

const VideoGenSchema = Type.Object({
  project_id: Type.String({ description: "Project ID (video_id)." }),
  shot_index: Type.Number({ description: "Shot number, starting from 1." }),
  prompt: Type.String({ description: "Motion/action description for the video (English)." }),
  image_path: Type.String({ description: "Keyframe image path (from image_gen output)." }),
  duration: Type.Optional(Type.Number({ description: "Duration in seconds, 1-15. Default 5." })),
  aspect_ratio: Type.Optional(Type.String({ description: 'Aspect ratio: "16:9" or "9:16". Default "16:9".' })),
  model: Type.Optional(Type.String({ description: '"sora2-standard" or "sora2-pro". Default "sora2-standard".' })),
});

export function createVideoGenTool(opts: { outputRoot?: string }) {
  return {
    label: "Video Gen",
    name: "video_gen",
    description:
      "Generate a video clip from a keyframe image + motion prompt via Sora2. Returns the local file path.",
    parameters: VideoGenSchema,
    execute: async (_toolCallId: string, args: unknown) => {
      const params = args as Record<string, unknown>;
      const projectId = params.project_id as string;
      const shotIndex = params.shot_index as number;
      const prompt = params.prompt as string;
      const imagePath = params.image_path as string;
      const duration = (params.duration as number) ?? 5;
      const aspectRatio = (params.aspect_ratio as string) ?? "16:9";
      const model = (params.model as string) ?? process.env.VIBEVIDEO_DEFAULT_MODEL ?? "sora2-standard";

      const apiKey = process.env.KIE_AI_API_KEY;
      if (!apiKey) {
        throw new Error("KIE_AI_API_KEY environment variable is required");
      }

      // Sora2 requires a publicly accessible image URL.
      // If imagePath is a local file, it needs to be uploaded first.
      // For now, assume the image is already accessible via URL or
      // the caller provides a public URL.
      let imageUrl = imagePath;
      if (!imagePath.startsWith("http")) {
        // Local file — read and convert to data URI as fallback.
        // Note: Sora2 may not accept data URIs; a presigned upload
        // mechanism should be added for production use.
        throw new Error(
          "video_gen requires a publicly accessible image URL. " +
          "Local file paths are not yet supported. " +
          "Please provide the image URL from image_gen output.",
        );
      }

      const root = resolveOutputRoot(opts.outputRoot);
      const clipsDir = path.join(root, "projects", projectId, "clips");
      await fs.mkdir(clipsDir, { recursive: true });

      const shotLabel = String(shotIndex).padStart(2, "0");
      const destPath = path.join(clipsDir, `shot_${shotLabel}.mp4`);

      const sora2Aspect = aspectRatio === "9:16" ? "portrait" : "landscape";
      await generateVideo(
        {
          prompt,
          imageUrl,
          aspectRatio: sora2Aspect,
          duration,
          model: model as "sora2-standard" | "sora2-pro",
          apiKey,
        },
        destPath,
      );

      const relPath = `clips/shot_${shotLabel}.mp4`;
      return {
        content: [{ type: "text", text: `Video clip saved: ${relPath}` }],
        details: { clipPath: destPath, projectId, shotIndex, duration },
      };
    },
  };
}
