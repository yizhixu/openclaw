import { Type } from "@sinclair/typebox";
import path from "node:path";
import fs from "node:fs/promises";
import { generateBgm } from "../api/kie-suno.js";
import { resolveOutputRoot } from "../utils/project.js";

const BgmGenSchema = Type.Object({
  project_id: Type.String({ description: "Project ID (video_id)." }),
  prompt: Type.String({ description: 'Music style description, e.g. "cyberpunk ambient, dark synth".' }),
  instrumental: Type.Optional(Type.Boolean({ description: "Pure instrumental (no vocals). Default true." })),
});

export function createBgmGenTool(opts: { outputRoot?: string }) {
  return {
    label: "BGM Gen",
    name: "bgm_gen",
    description:
      "Generate background music via Suno. Can run in parallel with image/video generation.",
    parameters: BgmGenSchema,
    execute: async (_toolCallId: string, args: unknown) => {
      const params = args as Record<string, unknown>;
      const projectId = params.project_id as string;
      const prompt = params.prompt as string;
      const instrumental = (params.instrumental as boolean) ?? true;

      const apiKey = process.env.KIE_AI_API_KEY;
      if (!apiKey) {
        throw new Error("KIE_AI_API_KEY environment variable is required");
      }

      const root = resolveOutputRoot(opts.outputRoot);
      const projectDir = path.join(root, "projects", projectId);
      await fs.mkdir(projectDir, { recursive: true });

      const destPath = path.join(projectDir, "bgm.mp3");

      await generateBgm({ prompt, instrumental, apiKey }, destPath);

      return {
        content: [{ type: "text", text: "BGM saved: bgm.mp3" }],
        details: { bgmPath: destPath, projectId },
      };
    },
  };
}
