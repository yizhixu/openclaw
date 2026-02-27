import { pollUntil } from "../utils/poll.js";
import { downloadFile } from "../utils/download.js";

const BASE_URL = "https://api.kie.ai/api/v1/generate";

export interface SunoBgmParams {
  prompt: string;
  instrumental?: boolean;
  apiKey: string;
}

export interface SunoBgmResult {
  audioUrl: string;
  taskId: string;
}

/**
 * Submit a Suno BGM generation task.
 * POST /api/v1/generate
 * Mirrors Python: suno.py create_task logic.
 */
async function createTask(params: SunoBgmParams): Promise<string> {
  const body = {
    prompt: params.prompt,
    customMode: false,
    instrumental: params.instrumental ?? true,
    model: "V5",
    callBackUrl: "https://placeholder.local/callback",
  };

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Suno createTask failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  if ((json.code as number) !== 200) {
    throw new Error(`Suno createTask error: ${json.msg ?? "Unknown error"}`);
  }

  const data = json.data as Record<string, unknown>;
  const taskId = data.taskId as string;
  if (!taskId) {
    throw new Error("Suno createTask: no taskId in response");
  }
  return taskId;
}

/** Error statuses from Suno API. Mirrors Python: suno.py */
const SUNO_ERROR_STATUSES = new Set([
  "CREATE_TASK_FAILED",
  "GENERATE_AUDIO_FAILED",
  "CALLBACK_EXCEPTION",
  "SENSITIVE_WORD_ERROR",
]);

/**
 * Poll Suno task until audio is ready.
 * GET /api/v1/generate/record-info?taskId=xxx
 * Poll interval: 10s, max wait: 300s.
 */
async function pollTaskResult(taskId: string, apiKey: string): Promise<string> {
  const url = `${BASE_URL}/record-info?taskId=${taskId}`;
  return pollUntil<string>(
    async () => {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return { done: false };

      const json = (await res.json()) as Record<string, unknown>;
      const data = json.data as Record<string, unknown> | undefined;
      if (!data) return { done: false };

      const status = data.status as string;

      if (SUNO_ERROR_STATUSES.has(status)) {
        const msg = (data.errorMessage ?? status) as string;
        return { done: false, error: `Suno task failed: ${msg}` };
      }

      // SUCCESS or FIRST_SUCCESS — extract audio URL
      if (status === "SUCCESS" || status === "FIRST_SUCCESS") {
        const response = data.response as Record<string, unknown> | undefined;
        const sunoData = response?.sunoData as Array<Record<string, unknown>> | undefined;
        const audioUrl = sunoData?.find((d) => d.audioUrl)?.audioUrl as string | undefined;
        if (audioUrl) {
          return { done: true, result: audioUrl };
        }
      }

      // PENDING, TEXT_SUCCESS — keep polling
      return { done: false };
    },
    { intervalMs: 10_000, maxWaitMs: 300_000 },
  );
}

/**
 * Generate background music via KIE.ai Suno API.
 * Optionally downloads the result to a local path.
 */
export async function generateBgm(
  params: SunoBgmParams,
  destPath?: string,
): Promise<SunoBgmResult> {
  const taskId = await createTask(params);
  const audioUrl = await pollTaskResult(taskId, params.apiKey);

  if (destPath) {
    await downloadFile(audioUrl, destPath);
  }

  return { audioUrl, taskId };
}
