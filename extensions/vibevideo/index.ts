import { createImageGenTool } from "./src/tools/image-gen.js";
import { createVideoGenTool } from "./src/tools/video-gen.js";
import { createBgmGenTool } from "./src/tools/bgm-gen.js";
import { createVideoComposeTool } from "./src/tools/video-compose.js";

interface PluginApi {
  registerTool: (tool: unknown) => void;
  pluginConfig?: Record<string, unknown>;
}

export default function (api: PluginApi) {
  const outputRoot = api.pluginConfig?.outputRoot as string | undefined;

  api.registerTool(createImageGenTool({ outputRoot }));
  api.registerTool(createVideoGenTool({ outputRoot }));
  api.registerTool(createBgmGenTool({ outputRoot }));
  api.registerTool(createVideoComposeTool({ outputRoot }));
}
