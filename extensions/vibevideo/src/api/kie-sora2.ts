import { pollUntil } from "../utils/poll.js";
import { downloadFile } from "../utils/download.js";

const BASE_URL = "https://api.kie.ai/api/v1/jobs";

export interface Sora2GenerateParams {
  prompt: string;
  imageUrl: string;
  aspectRatio: "portrait" | "landscape";
  duration: number;
  model?: "sora2-standard" | "sora2-pro";
  apiKey: string;
}

export interface Sora2Result {
  videoUrl: string;
  taskId: string;
}

/**
 * Resolve the KIE.ai model name from our shorthand.
 * Mirrors Python: kie_sora2_video_generator.py model mapping.
 */
function resolveModelName(model?: string): string {
  if (model === "sora2-pro") return "sora-2-pro-image-to-video";
  return "sora-2-image-to-video";
}

/**
 * Submit a Sora2 image-to-video task.
 * POST /api/v1/jobs/createTask
 */
async function createTask(params: Sora2GenerateParams): Promise<string> {
  const body = {
    model: resolveModelName(params.model),
    input: {
      prompt: params.prompt,
      image_urls: [params.imageUrl],
      aspect_ratio: params.aspectRatio,
      n_frames: String(params.duration),
    },
  };

  const res = await fetch(`${BASE_URL}/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Sora2 createTask failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const code = json.code as number;
  if (code !== 0 && code !== 200) {
    const msg = (json.message ?? json.msg ?? "Unknown error") as string;
    throw new Error(`Sora2 createTask error: ${msg}`);
  }

  const data = json.data as Record<string, unknown>;
  const taskId = (data.task_id ?? data.taskId) as string;
  if (!taskId) {
    throw new Error("Sora2 createTask: no task_id in response");
  }
  return taskId;
}

/**
 * Poll task status until success or failure.
 * GET /api/v1/jobs/recordInfo?task_id=xxx&taskId=xxx
 * Mirrors Python polling logic: 5s interval, 600s max.
 */
async function pollTaskResult(taskId: string, apiKey: string): Promise<string> {
  const url = `${BASE_URL}/recordInfo?task_id=${taskId}&taskId=${taskId}`;
  return pollUntil<string>(
    async () => {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        return { done: false };
      }
      const json = (await res.json()) as Record<string, unknown>;
      const data = json.data as Record<string, unknown> | undefined;
      if (!data) return { done: false };

      const state = ((data.state ?? data.status) as string)?.toLowerCase();

      if (state === "success") {
        const result = data.result as Record<string, unknown> | undefined;
        const videoUrl =
          (result?.video_url as string) ??
          ((data.resultUrls as string[] | undefined)?.[0]);
        if (!videoUrl) {
          return { done: false, error: "Sora2: success but no video URL" };
        }
        return { done: true, result: videoUrl };
      }

      if (state === "failed" || state === "fail" || state === "error") {
        const msg = (data.failMsg ?? data.error ?? "Task failed") as string;
        return { done: false, error: `Sora2 task failed: ${msg}` };
      }

      // pending / running / processing — keep polling
      return { done: false };
    },
    { intervalMs: 5_000, maxWaitMs: 600_000 },
  );
}

/**
 * Generate a video clip from an image + prompt via KIE.ai Sora2 API.
 * Optionally downloads the result to a local path.
 */
export async function generateVideo(
  params: Sora2GenerateParams,
  destPath?: string,
): Promise<Sora2Result> {
  const taskId = await createTask(params);
  const videoUrl = await pollTaskResult(taskId, params.apiKey);

  if (destPath) {
    await downloadFile(videoUrl, destPath);
  }

  return { videoUrl, taskId };
}
