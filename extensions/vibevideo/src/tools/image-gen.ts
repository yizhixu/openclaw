import { Type } from "@sinclair/typebox";
import path from "node:path";
import fs from "node:fs/promises";
import { generateImage } from "../api/image-providers.js";
import { resolveOutputRoot } from "../utils/project.js";

const ImageGenSchema = Type.Object({
  project_id: Type.String({ description: "Project ID (video_id)." }),
  shot_index: Type.Number({ description: "Shot number, starting from 1." }),
  prompt: Type.String({ description: "Visual description for the image (English)." }),
  aspect_ratio: Type.Optional(Type.String({ description: 'Aspect ratio, e.g. "16:9". Default "16:9".' })),
  reference_image: Type.Optional(Type.String({ description: "Reference image path or URL (optional)." })),
});

export function createImageGenTool(opts: { outputRoot?: string }) {
  return {
    label: "Image Gen",
    name: "image_gen",
    description:
      "Generate a keyframe image for a video shot. Returns the local file path of the saved image.",
    parameters: ImageGenSchema,
    execute: async (_toolCallId: string, args: unknown) => {
      const params = args as Record<string, unknown>;
      const projectId = params.project_id as string;
      const shotIndex = params.shot_index as number;
      const prompt = params.prompt as string;
      const aspectRatio = (params.aspect_ratio as string) ?? "16:9";
      const referenceImage = params.reference_image as string | undefined;

      const apiKey = process.env.ARK_API_KEY;
      if (!apiKey) {
        throw new Error("ARK_API_KEY environment variable is required");
      }

      const root = resolveOutputRoot(opts.outputRoot);
      const projectDir = path.join(root, "projects", projectId);
      const imagesDir = path.join(projectDir, "images");
      await fs.mkdir(imagesDir, { recursive: true });

      const shotLabel = String(shotIndex).padStart(2, "0");
      const destPath = path.join(imagesDir, `shot_${shotLabel}.png`);

      await generateImage(
        { prompt, aspectRatio, referenceImageUrl: referenceImage, apiKey },
        destPath,
      );

      const relPath = `images/shot_${shotLabel}.png`;
      return {
        content: [{ type: "text", text: `Image saved: ${relPath}` }],
        details: { imagePath: destPath, projectId, shotIndex },
      };
    },
  };
}
