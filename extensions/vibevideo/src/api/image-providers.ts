import { downloadFile } from "../utils/download.js";

/** Aspect ratio to resolution mapping. Mirrors Python: ark.py size mapping. */
const SIZE_MAP: Record<string, string> = {
  "16:9": "2560x1440",
  "9:16": "1440x2560",
  "1:1": "1920x1920",
};

export interface ImageGenerateParams {
  prompt: string;
  aspectRatio?: string;
  referenceImageUrl?: string;
  apiKey: string;
}

export interface ImageGenerateResult {
  imageUrl: string;
}

/**
 * ARK (Volcengine) image provider.
 * Mirrors Python: ark.py — POST /api/v3/images/generate (synchronous).
 */
class ArkProvider {
  private baseUrl: string;
  private model = "doubao-seedream-4-5-251128";

  constructor() {
    this.baseUrl = process.env.ARK_API_HOST
      ? `https://${process.env.ARK_API_HOST}/api/v3`
      : "https://ark.cn-beijing.volces.com/api/v3";
  }

  async generate(params: ImageGenerateParams): Promise<ImageGenerateResult> {
    const size = SIZE_MAP[params.aspectRatio ?? "16:9"] ?? "2560x1440";

    const body: Record<string, unknown> = {
      model: this.model,
      prompt: params.prompt,
      size,
      watermark: false,
      seed: 42,
    };
    if (params.referenceImageUrl) {
      body.image = [params.referenceImageUrl];
    }

    const res = await fetch(`${this.baseUrl}/images/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`ARK generate failed: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as Record<string, unknown>;
    const data = json.data as Array<Record<string, unknown>> | undefined;
    const imageUrl = data?.[0]?.url as string | undefined;
    if (!imageUrl) {
      throw new Error("ARK: no image URL in response");
    }
    return { imageUrl };
  }
}

/** Singleton ARK provider instance. */
let arkInstance: ArkProvider | null = null;

/**
 * Get the ARK image provider.
 * Currently only ARK is supported; extend here to add more providers.
 */
export function getImageProvider(): ArkProvider {
  if (!arkInstance) {
    arkInstance = new ArkProvider();
  }
  return arkInstance;
}

/**
 * Generate an image and optionally download to a local path.
 */
export async function generateImage(
  params: ImageGenerateParams,
  destPath?: string,
): Promise<ImageGenerateResult> {
  const provider = getImageProvider();
  const result = await provider.generate(params);

  if (destPath) {
    await downloadFile(result.imageUrl, destPath);
  }

  return result;
}
