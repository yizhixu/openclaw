# VibeVideo Extension — 实现计划

## 目标

在 OpenClaw 框架上实现视频自动生成能力：用户提供需求描述和参考素材，agent 在后台自主完成从脚本创作到视频合成的全流程，输出完整视频文件。

## 架构概览

```
用户消息 → OpenClaw Agent (LLM)
               │
               ├─ 1. LLM 自主生成分镜脚本 (无需工具，纯文本推理)
               ├─ 2. image_gen 工具 → 生成每个镜头关键帧
               ├─ 3. video_gen 工具 → 图片+prompt → Sora2 视频片段
               ├─ 4. bgm_gen 工具 → 生成背景音乐
               └─ 5. video_compose 工具 → ffmpeg 合成最终视频
               │
               ▼
          本地文件 + MEDIA:<path> 投递给用户
```

核心思路：LLM 做导演（创意决策），工具做执行（API 调用 + 文件处理）。
不需要 LangGraph 状态机，agent 本身就是编排器。

## 与原 vibevideo 项目的关系

| 原 Python 组件 | OpenClaw 中的对应 | 说明 |
|---|---|---|
| StoryCreator / StoryBoarder / StoryPrompter | Agent LLM 自身 | 不再需要专用 agent，主 LLM 直接完成 |
| LangGraph StateGraph | 无 | agent 自主编排，SKILL.md 引导流程 |
| `kie_sora2_video_generator.py` | `src/api/kie-sora2.ts` | TypeScript 重写 API client |
| `suno.py` | `src/api/kie-suno.ts` | TypeScript 重写 API client |
| `image_generator_base.py` + providers | `src/api/image-providers.ts` | TypeScript 重写 |
| PostgreSQL / Redis | 无 | 不需要，文件存本地 workspace |
| StoryState | 无 | agent 上下文即状态 |

## 文件结构

```
extensions/vibevideo/
├── package.json                 # 插件包定义
├── index.ts                     # 插件入口，注册所有工具
├── PLAN.md                      # 本文档
├── SKILL.md                     # Agent 工作流引导
├── src/
│   ├── tools/
│   │   ├── image-gen.ts         # 图片生成工具
│   │   ├── video-gen.ts         # Sora2 视频生成工具
│   │   ├── bgm-gen.ts           # BGM 生成工具
│   │   └── video-compose.ts     # ffmpeg 视频合成工具
│   ├── api/
│   │   ├── kie-sora2.ts         # KIE.ai Sora2 API client
│   │   ├── kie-suno.ts          # KIE.ai Suno BGM API client
│   │   └── image-providers.ts   # 图片生成 provider 抽象层
│   └── utils/
│       ├── project.ts           # 项目目录管理
│       ├── poll.ts              # 通用异步轮询
│       └── download.ts          # 文件下载工具
└── test/
    ├── kie-sora2.test.ts
    ├── kie-suno.test.ts
    └── video-compose.test.ts
```

## 本地存储结构

每次视频任务在 workspace 下创建独立项目目录：

```
~/vibevideo/output/
└── projects/
    └── <video_id>/
        ├── script.md            # 分镜脚本 (agent 生成，Markdown 格式)
        ├── images/
        │   ├── shot_01.png      # 关键帧图片
        │   ├── shot_02.png
        │   └── ...
        ├── clips/
        │   ├── shot_01.mp4      # Sora2 生成的视频片段
        │   ├── shot_02.mp4
        │   └── ...
        ├── bgm.mp3              # 背景音乐
        └── output.mp4           # 最终合成视频
```

`video_id` 由工具自动生成（时间戳 + 随机后缀），确保唯一性。

## 实现步骤

### Phase 1: 插件骨架 + 项目管理

1. 创建 `package.json`，声明插件元数据和依赖
2. 创建 `index.ts` 插件入口，通过 `api.registerTool()` 注册 4 个工具
3. 实现 `src/utils/project.ts`：项目目录创建、video_id 生成、路径解析
4. 实现 `src/utils/poll.ts`：通用异步轮询（提交任务 → 轮询状态 → 超时处理）
5. 实现 `src/utils/download.ts`：从 URL 下载文件到本地

### Phase 2: API Client 层

从原 Python 代码移植，逐个实现：

#### 2a. KIE.ai Sora2 Client (`src/api/kie-sora2.ts`)

移植自 `vibevideo/backend/external/kie_sora2_video_generator.py`。

```typescript
// 核心接口
export async function generateVideo(params: {
  prompt: string;
  imageUrl: string;          // 关键帧图片 URL（必须公网可访问）
  aspectRatio: "portrait" | "landscape";
  duration: number;          // 1-15 秒
  model?: "sora2-standard" | "sora2-pro";
  apiKey: string;
}): Promise<{ videoUrl: string; taskId: string }>
```

API 流程：
- `POST https://api.kie.ai/api/v1/jobs/createTask` → 获取 task_id
- 轮询 `GET /api/v1/jobs/recordInfo?taskId=xxx`（每 5 秒，最长 600 秒）
- 状态：pending → running → processing → success/failed
- 成功后下载视频到本地 clips 目录

环境变量：`KIE_AI_API_KEY`

#### 2b. KIE.ai Suno BGM Client (`src/api/kie-suno.ts`)

移植自 `vibevideo/backend/external/suno.py`。

```typescript
export async function generateBgm(params: {
  prompt: string;
  instrumental?: boolean;    // 默认 true（纯音乐，无人声）
  apiKey: string;
}): Promise<{ audioUrl: string; taskId: string }>
```

API 流程：
- `POST https://api.kie.ai/api/v1/generate` → 获取 task_id
- 轮询 `GET /api/v1/generate/record-info`（每 10 秒，最长 300 秒）
- 状态：PENDING → TEXT_SUCCESS → FIRST_SUCCESS → SUCCESS
- 从 `sunoData[0].audioUrl` 提取音频 URL

环境变量：复用 `KIE_AI_API_KEY`

#### 2c. 图片生成 Provider (`src/api/image-providers.ts`)

移植自 `vibevideo/backend/external/` 下的各 provider。初期只实现一个（建议 Flux 或 Ark），后续按需扩展。

```typescript
export interface ImageProvider {
  generate(params: {
    prompt: string;
    aspectRatio: string;
    resolution?: string;
    referenceImage?: string;
  }): Promise<{ imagePath: string }>;
}

export function createImageProvider(provider: string): ImageProvider;
```

支持的 aspect ratio 映射（沿用原项目）：
- `16:9` → `854x480`
- `9:16` → `480x854`
- `1:1` → `480x480`

### Phase 3: 工具层

每个工具通过 `api.registerTool()` 注册，遵循 `AnyAgentTool` 接口（`@mariozechner/pi-agent-core` 的 `AgentTool`）。
参数 schema 使用 `@sinclair/typebox`，不使用 `Type.Union`（项目 guardrail）。

#### 3a. `image_gen` 工具 (`src/tools/image-gen.ts`)

为指定镜头生成关键帧图片。

```typescript
// 参数
{
  project_id: string;        // 项目 ID（由之前的工具调用创建）
  shot_index: number;        // 镜头序号（从 1 开始）
  prompt: string;            // 画面描述
  aspect_ratio?: string;     // 默认 "16:9"
  reference_image?: string;  // 参考图片路径（可选）
}

// 返回
{
  content: [{ type: "text", text: "Image saved: images/shot_01.png" }],
  details: { imagePath: "/.../projects/<id>/images/shot_01.png" }
}
```

内部流程：
1. 确保项目目录存在（`utils/project.ts`）
2. 调用 `ImageProvider.generate()` 生成图片
3. 保存到 `projects/<id>/images/shot_<NN>.png`
4. 返回本地路径

#### 3b. `video_gen` 工具 (`src/tools/video-gen.ts`)

将关键帧图片 + prompt 通过 Sora2 生成视频片段。

```typescript
// 参数
{
  project_id: string;
  shot_index: number;
  prompt: string;            // 镜头运动/动作描述
  image_path: string;        // 关键帧图片路径（来自 image_gen 输出）
  duration?: number;         // 时长秒数，默认 5，范围 1-15
  aspect_ratio?: string;     // 默认 "16:9"
  model?: string;            // "sora2-standard" 或 "sora2-pro"
}

// 返回
{
  content: [{ type: "text", text: "Video clip saved: clips/shot_01.mp4" }],
  details: { clipPath: "/.../projects/<id>/clips/shot_01.mp4", duration: 5 }
}
```

内部流程：
1. 读取本地图片，上传到可公网访问的临时存储（或生成 presigned URL）
2. 调用 `kie-sora2.generateVideo()` 提交任务
3. 轮询等待完成（最长 10 分钟）
4. 下载视频到 `projects/<id>/clips/shot_<NN>.mp4`
5. 返回本地路径

注意：Sora2 API 要求图片 URL 公网可访问。需要一个临时上传机制（S3 presigned 或其他）。

#### 3c. `bgm_gen` 工具 (`src/tools/bgm-gen.ts`)

生成背景音乐。

```typescript
// 参数
{
  project_id: string;
  prompt: string;            // 音乐风格描述，如 "cyberpunk ambient, dark synth"
  instrumental?: boolean;    // 默认 true（纯音乐）
}

// 返回
{
  content: [{ type: "text", text: "BGM saved: bgm.mp3" }],
  details: { bgmPath: "/.../projects/<id>/bgm.mp3" }
}
```

内部流程：
1. 调用 `kie-suno.generateBgm()` 提交任务
2. 轮询等待完成（最长 5 分钟）
3. 下载音频到 `projects/<id>/bgm.mp3`
4. 返回本地路径

Agent 可以在生成图片/视频的同时并行调用此工具，节省总耗时。

#### 3d. `video_compose` 工具 (`src/tools/video-compose.ts`)

将所有视频片段 + BGM 合成为最终视频。

```typescript
// 参数
{
  project_id: string;
  clips: string[];           // 视频片段路径列表，按顺序拼接
  bgm_path?: string;         // BGM 文件路径（可选）
  bgm_volume?: number;       // BGM 音量，0.0-1.0，默认 0.3
  transition?: string;       // 转场效果："none" | "crossfade"，默认 "crossfade"
  crossfade_duration?: number; // 转场时长秒数，默认 0.5
}

// 返回
{
  content: [{ type: "text", text: "MEDIA:<output_path>" }],
  details: { outputPath: "/.../projects/<id>/output.mp4", duration: 30 }
}
```

内部流程：
1. 验证所有 clip 文件存在
2. 生成 ffmpeg concat 文件列表
3. 执行 ffmpeg 拼接（可选 crossfade 转场）
4. 如有 BGM，混合音轨（`-filter_complex amix`）
5. 输出到 `projects/<id>/output.mp4`
6. 返回 `MEDIA:<path>` 格式，gateway 自动投递给用户

前置依赖：系统需安装 ffmpeg。工具启动时检测，未安装则报错提示。

### Phase 4: SKILL.md + 插件入口

#### 4a. SKILL.md

SKILL.md 是 agent 的"导演手册"，引导 LLM 按正确流程工作。放在 `extensions/vibevideo/SKILL.md`。

核心内容：

```markdown
# Video Production

当用户要求制作视频时，按以下流程执行：

## Step 1: 分镜脚本

根据用户需求，生成 Markdown 格式的分镜脚本（`script.md`），格式如下：

```
# 视频标题

- 画面比例: 16:9
- BGM 风格: cyberpunk ambient, dark synth

## Shot 1 (5s)

**画面描述:** A futuristic cityscape at night...
**运动描述:** Slow dolly forward through neon-lit streets...

## Shot 2 (4s)

**画面描述:** Close-up of a robot's face...
**运动描述:** Camera slowly zooms into the glowing eyes...
```

将脚本保存到项目目录的 `script.md` 后，进入素材生成阶段。

## Step 2: 素材生成

并行执行：
- 对每个镜头调用 image_gen 生成关键帧
- 调用 bgm_gen 生成背景音乐

## Step 3: 视频片段生成

对每个镜头，用 image_gen 的输出 + motion_prompt 调用 video_gen。
可并行调用多个 video_gen（建议每批 3-4 个，避免 API 限流）。

## Step 4: 合成

所有片段和 BGM 就绪后，调用 video_compose 合成最终视频。

## 约束
- 总时长建议 15-60 秒（镜头数 3-12 个）
- 每个镜头时长 3-10 秒
- visual_prompt 和 motion_prompt 必须用英文
- 如果某个工具调用失败，向用户说明并跳过该镜头
```

#### 4b. 插件入口 (`index.ts`)

通过 OpenClaw 插件 API 注册工具，不需要修改核心代码。

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createImageGenTool } from "./src/tools/image-gen.js";
import { createVideoGenTool } from "./src/tools/video-gen.js";
import { createBgmGenTool } from "./src/tools/bgm-gen.js";
import { createVideoComposeTool } from "./src/tools/video-compose.js";

export default function (api: OpenClawPluginApi) {
  const outputRoot = api.pluginConfig?.outputRoot as string | undefined;

  api.registerTool((ctx) => createImageGenTool({ config: api.config, outputRoot }));
  api.registerTool((ctx) => createVideoGenTool({ config: api.config, outputRoot }));
  api.registerTool((ctx) => createBgmGenTool({ config: api.config, outputRoot }));
  api.registerTool((ctx) => createVideoComposeTool({ config: api.config, outputRoot }));
}
```

`registerTool` 接受 `OpenClawPluginToolFactory`，在每次 agent 会话启动时调用，返回 `AnyAgentTool`。

### Phase 5: 配置

#### 5a. `package.json`

```json
{
  "name": "@openclaw/vibevideo",
  "version": "0.1.0",
  "description": "AI video generation plugin for OpenClaw",
  "type": "module",
  "dependencies": {
    "@sinclair/typebox": "0.34.48"
  },
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

不需要额外 npm 依赖。HTTP 请求用 Node 22 内置的 `fetch`，ffmpeg 通过 `child_process` 调用。

#### 5b. openclaw.yaml 配置示例

```yaml
# 启用 vibevideo 插件
plugins:
  vibevideo:
    outputRoot: ~/vibevideo/output   # 视频输出根目录

# 为视频生成 agent 配置受限权限
agents:
  list:
    - id: videogen
      workspace: ~/vibevideo/output
      tools:
        profile: minimal
        alsoAllow:
          - image_gen
          - video_gen
          - bgm_gen
          - video_compose
      model: claude-sonnet-4-6       # 性价比优先，不需要 opus

# 限制文件系统访问范围
tools:
  fs:
    workspaceOnly: true
```

#### 5c. 环境变量

```bash
# 必需
KIE_AI_API_KEY=xxx           # KIE.ai API key（Sora2 + Suno 共用）

# 图片生成（按所选 provider 配置其一）
ARK_API_KEY=xxx              # Ark provider
FLUX_API_KEY=xxx             # Flux provider

# 可选
VIBEVIDEO_OUTPUT_ROOT=~/vibevideo/output   # 覆盖默认输出目录
VIBEVIDEO_DEFAULT_MODEL=sora2-standard     # 默认视频模型
```

### Phase 6: 测试

#### 6a. 单元测试

每个 API client 和工具都有对应的 `.test.ts`，使用 vitest。

- `test/kie-sora2.test.ts` — mock HTTP 响应，测试轮询逻辑、超时、错误处理
- `test/kie-suno.test.ts` — mock HTTP 响应，测试 BGM 生成流程
- `test/video-compose.test.ts` — mock ffmpeg 调用，测试 concat 文件生成和参数拼接

测试不调用真实 API，全部 mock。

#### 6b. Live 测试

用真实 API key 跑端到端测试，手动触发：

```bash
KIE_AI_API_KEY=xxx pnpm vitest run extensions/vibevideo/test/ --config vitest.live.config.ts
```

#### 6c. 集成验收

通过消息通道发送测试指令，验证完整流程：

```
用户: 帮我做一个5秒的视频，一只猫在月球上跳舞
预期: agent 生成脚本 → 图片 → 视频片段 → BGM → 合成 → 返回 output.mp4
```
