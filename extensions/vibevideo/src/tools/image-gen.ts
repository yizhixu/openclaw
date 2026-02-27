import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { generateImage } from "../api/image-providers.js";
import { resolveOutputRoot } from "../utils/project.js";

const ImageGenSchema = Type.Object({
  project_id: Type.String({ description: "Project ID (video_id)." }),
  character_id: Type.String({ description: "Character identifier, e.g. 'char_01'." }),
  prompt: Type.String({
    description:
      "Character design sheet prompt (English). Must include visual style, full-body reference with front/side/back views on white background.",
  }),
  aspect_ratio: Type.Optional(
    Type.String({ description: 'Aspect ratio. Default "9:16" for Sora2 mode.' }),
  ),
  reference_image: Type.Optional(
    Type.String({ description: "Reference image URL for style consistency (optional)." }),
  ),
});

export function createImageGenTool(opts: { outputRoot?: string }) {
  return {
    label: "Image Gen",
    name: "image_gen",
    description:
      "Generate a character design sheet image via ARK API. Returns the image URL and local file path.",
    parameters: ImageGenSchema,
    execute: async (_toolCallId: string, args: unknown) => {
      const params = args as Record<string, unknown>;
      const projectId = params.project_id as string;
      const characterId = params.character_id as string;
      const prompt = params.prompt as string;
      const aspectRatio = (params.aspect_ratio as string) ?? "9:16";
      const referenceImage = params.reference_image as string | undefined;

      const apiKey = process.env.ARK_TOKEN ?? process.env.ARK_API_KEY;
      if (!apiKey) {
        throw new Error("ARK_TOKEN (or ARK_API_KEY) environment variable is required");
      }

      const root = resolveOutputRoot(opts.outputRoot);
      const projectDir = path.join(root, "projects", projectId);
      const charsDir = path.join(projectDir, "characters");
      await fs.mkdir(charsDir, { recursive: true });

      const destPath = path.join(charsDir, `${characterId}.png`);

      const result = await generateImage(
        { prompt, aspectRatio, referenceImageUrl: referenceImage, apiKey },
        destPath,
      );

      const relPath = `characters/${characterId}.png`;
      return {
        content: [
          {
            type: "text",
            text: `Character design saved: ${relPath}\nimageUrl: ${result.imageUrl}`,
          },
        ],
        details: { imagePath: destPath, imageUrl: result.imageUrl, projectId, characterId },
      };
    },
  };
}
