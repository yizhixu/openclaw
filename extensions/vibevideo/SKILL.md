# Video Production Skill

当用户要求制作视频时，按以下流程自主完成全部工作。

## Step 1: 理解需求

分析用户的需求描述和参考素材，确定：
- 视频主题和风格
- 目标时长（建议 15-60 秒）
- 画面比例（默认 16:9，竖屏用 9:16）
- 参考图片或风格关键词

## Step 2: 创建项目

调用任意工具时使用统一的 `project_id`。格式为时间戳+随机后缀（如 `20260227061500_a1b2c3`），在第一次调用工具前自行生成。

## Step 3: 编写分镜脚本

根据需求创作分镜脚本，保存为 Markdown 文件（`script.md`）。格式：

```markdown
# 视频标题

- 画面比例: 16:9
- BGM 风格: cinematic orchestral, epic and emotional

## Shot 1 (5s)

**画面描述:** A vast desert landscape at golden hour, sand dunes stretching to the horizon...
**运动描述:** Slow aerial dolly forward over the dunes, camera gradually descending...

## Shot 2 (4s)

**画面描述:** Close-up of ancient stone ruins half-buried in sand...
**运动描述:** Gentle pan left revealing the full extent of the ruins...
```

### 画面描述（visual prompt）写作规范

- 必须使用英文
- 描述具体的视觉元素：场景、光线、色调、构图
- 包含艺术风格关键词（如 cinematic, anime, watercolor）
- 避免抽象概念，只描述可视化的内容
- 不要包含角色名字，用外观描述代替

### 运动描述（motion prompt）写作规范

- 必须使用英文
- 描述镜头运动：pan, tilt, dolly, zoom, tracking, crane, handheld
- 描述主体动作：walking, turning, reaching, flying
- 指定运动速度：slow, gentle, rapid, sudden
- 保持与画面描述的一致性

## Step 4: 素材生成

并行执行以下任务：

1. 对每个镜头调用 `image_gen` 生成关键帧图片
2. 调用 `bgm_gen` 生成背景音乐（与图片生成同时进行）

每次 `image_gen` 调用需要传入：
- `project_id`: 项目 ID
- `shot_index`: 镜头序号
- `prompt`: 画面描述（来自脚本）
- `aspect_ratio`: 画面比例

## Step 5: 视频片段生成

关键帧图片就绪后，对每个镜头调用 `video_gen`：

- `project_id`: 项目 ID
- `shot_index`: 镜头序号
- `prompt`: 运动描述（来自脚本）
- `image_path`: 关键帧图片的 URL（来自 `image_gen` 返回的 imageUrl）
- `duration`: 时长秒数

建议每批并行 3-4 个调用，避免 API 限流。

## Step 6: 合成最终视频

所有视频片段和 BGM 就绪后，调用 `video_compose`：

- `project_id`: 项目 ID
- `clips`: 所有视频片段路径，按镜头顺序排列
- `bgm_path`: BGM 文件路径
- `bgm_volume`: BGM 音量（建议 0.3）
- `transition`: 转场效果（建议 "crossfade"）

合成完成后，工具会返回 `MEDIA:<path>` 格式的结果，视频会自动投递给用户。

## 约束

- 总时长建议 15-60 秒（镜头数 3-12 个）
- 每个镜头时长 3-10 秒
- visual_prompt 和 motion_prompt 必须用英文
- 如果某个工具调用失败，向用户说明并跳过该镜头，继续处理其余镜头
- 所有中间产物保存在项目目录下，最终视频为 `output.mp4`
