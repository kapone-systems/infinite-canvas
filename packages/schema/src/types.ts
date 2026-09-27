/**
 * 方案第 9.1–9.2 节工程 / 节点类型，以及 9.4–9.6 节 RunPlan / RunSnapshot / RecipeFile / 任务记录。
 * MediaRef 来自第 9.3 节，因为 ProjectNode.output 引用它。
 * 不要在别的包再写一套同名字段。不要再定义 RunIntent。
 */

/** 工程内相对路径：正斜杠，不以 / 开头，不含盘符，不含 .. */
export type ProjectRelPath = string;

export const PROJECT_FORMAT = "canvas-project" as const;
export const SCHEMA_VERSION = 1 as const;
export const MEDIA_HASH_ALGORITHM = "sha256" as const;

/**
 * 相机。x/y 是视口中心对应的世界坐标（缩放为 1 时的 CSS 像素），不是画布左上角。
 * 节点可以落在负坐标。
 * screenX = (worldX - camera.x) * zoom + viewportWidth / 2
 * screenY = (worldY - camera.y) * zoom + viewportHeight / 2
 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasProjectFile {
  format: "canvas-project";
  schemaVersion: 1;
  projectId: string;
  name: string;
  mediaHashAlgorithm: "sha256";
  contentRevision: number;
  savedContentRevision: number;
  nextSerial: number;
  createdAt: string; // ISO-8601，带时区偏移
  updatedAt: string;
  viewport: Camera | null;
  nodes: Record<string, ProjectNode>;
  edges: Record<string, ProjectEdge>;
  groups: Record<string, ProjectGroup>;
}

export interface ProjectGroup {
  id: string;
  title: string;
  childIds: string[];
}

export type NodeKind = "text" | "image" | "video" | "audio" | "generation";
export type MediaKind = "text" | "image" | "video" | "audio";
export type Origin = "authored" | "imported" | "generated" | "detached";
export type Phase = "idle" | "queued" | "running" | "succeeded" | "failed";
export type Freshness = "fresh" | "stale";

export type SlotRole =
  | "prompt"
  | "source_image"
  | "reference_image"
  | "style_reference"
  | "character_reference"
  | "mask"
  | "first_frame"
  | "last_frame"
  | "audio_reference";

export const NODE_KINDS = [
  "text",
  "image",
  "video",
  "audio",
  "generation",
] as const satisfies readonly NodeKind[];

export const MEDIA_KINDS = [
  "text",
  "image",
  "video",
  "audio",
] as const satisfies readonly MediaKind[];

export const ORIGINS = [
  "authored",
  "imported",
  "generated",
  "detached",
] as const satisfies readonly Origin[];

export const PHASES = [
  "idle",
  "queued",
  "running",
  "succeeded",
  "failed",
] as const satisfies readonly Phase[];

export const FRESHNESSES = ["fresh", "stale"] as const satisfies readonly Freshness[];

export const SLOT_ROLES = [
  "prompt",
  "source_image",
  "reference_image",
  "style_reference",
  "character_reference",
  "mask",
  "first_frame",
  "last_frame",
  "audio_reference",
] as const satisfies readonly SlotRole[];

/** 方案第 9.2 节默认节点尺寸（世界像素）。 */
export const DEFAULT_NODE_SIZE = {
  text: { width: 280, height: 180 },
  image: { width: 280, minHeight: 80 },
  video: { width: 320, minHeight: 180 },
  audio: { width: 280, height: 96 },
  generation: { width: 320 },
} as const;

export interface ProjectNode {
  id: string;
  kind: NodeKind;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  groupId: string | null;
  origin: Origin;
  createdAt: string;
  updatedAt: string;
  outputRevision: number; // 对外输出身份。何时 +1 见第 5.8 节
  text?: string; // 仅 text 素材节点
  promptDraft?: string; // 仅 generation；有提示词连线时不用
  capabilityId?: string | null;
  profileId?: string | null; // 创建时由工具栏点中的能力写入，第一版不可改
  recipeId?: string | null; // 创建规则见第 9.2 节「配方如何贴上节点」
  recipeVersion?: number | null;
  outputKind?: MediaKind;
  params?: Record<string, string | number | boolean | null>;
  variantCount?: number; // 1..4
  slots?: Slot[];
  versions?: ResultVersion[];
  currentVersionId?: string | null;
  activeVariantId?: string | null;
  output?: MediaRef | null; // image/video/audio 的当前对外媒体。文本类结果不用此字段装长文
  outputText?: string | null; // outputKind===text 时的当前对外正文
  phase?: Phase;
  freshness?: Freshness;
  inputsChangedWhileRunning?: boolean;
  lastSuccessFingerprint?: string | null;
  lastAttemptFingerprint?: string | null;
  lastError?: UserFacingError | null;
  runner?: "local" | "cloud" | null;
  progress?: { ratio: number | null; label: string | null } | null;
  provenance?: { sourceNodeId: string; versionId: string; variantId: string } | null;
  /** 云端配方创建时从 RecipeSummary.providerId 抄来。不是密钥。本机配方为 null。 */
  secretRef?: { providerId: string; account: string } | null;
  /** 最近一次入队的 run / task。刷新后「只补失败的」「续跑」打这两条。没有则按钮禁用。 */
  lastRunId?: string | null;
  lastTaskId?: string | null;
  /** 后端每写一次执行字段 +1。工作副本合并用，见第 9.9 节。 */
  executionRevision?: number;
}

export interface Slot {
  id: string;
  role: SlotRole;
  order: number; // 从 0 连续
  edgeId: string | null;
}

export interface ProjectEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  targetSlotId: string;
  role: SlotRole; // 必须等于目标槽的 role
}

export interface ResultVersion {
  id: string;
  createdAt: string;
  fingerprint: string;
  recipeId: string;
  recipeVersion: number;
  paramSnapshot: Record<string, string | number | boolean | null>;
  variantCountRequested: number;
  variants: Variant[];
}

export interface Variant {
  id: string;
  index: number;
  phase: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  seedUsed: number | null;
  output: MediaRef | null; // image/video/audio 成功时必有
  text: string | null; // outputKind===text 时用；此时 output 必须为 null
  error: UserFacingError | null;
  createdAt: string;
}

export interface UserFacingError {
  code: string;
  message: string; // 一句中文。不含栈、密钥、完整工作流、绝对路径
  detail?: string; // 默认收起，最多 200 字符
}

/** 方案第 9.3 节。路径字段要么为 null，要么是合法相对路径，不要用空字符串冒充。 */
export interface MediaRef {
  kind: Exclude<MediaKind, "text">;
  relativePath: ProjectRelPath; // 原件 blob 路径。画布不得把它设成 <video> 地址
  contentHash: string | null; // sha256 小写 64 位；未知则为 null，不要编
  byteSize: number | null;
  mimeDetected: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null; // 没有时长就显示「时长未知」，不要 0:00
  firstFrameRelativePath: ProjectRelPath | null;
  lastFrameRelativePath: ProjectRelPath | null;
  coverRelativePath: ProjectRelPath | null;
  proxyRelativePath: ProjectRelPath | null; // 画布唯一允许的播放文件
  thumbRelativePath: ProjectRelPath | null; // 近景图片只用它
}

/** 方案第 9.9 节 PUT /api/projects/current/working-copy 请求体。 */
export interface WorkingCopyPutBody {
  contentRevision: number;
  nodes: Record<string, ProjectNode>;
  edges: Record<string, ProjectEdge>;
  groups: Record<string, ProjectGroup>;
}

/**
 * 客户端权威字段（第 9.9 节）。
 * 用户切换当前变体时还可以写 VARIANT_POINTER_FIELDS，但 queued/running 时那六项仍以服务器为准。
 */
export const CLIENT_AUTHORITATIVE_NODE_FIELDS = [
  "x",
  "y",
  "width",
  "height",
  "z",
  "title",
  "text",
  "promptDraft",
  "slots",
  "params",
  "variantCount",
  "recipeId",
  "recipeVersion",
  "capabilityId",
  "profileId",
  "outputKind",
  "groupId",
  "origin",
  "provenance",
  "secretRef",
  "kind",
] as const satisfies readonly (keyof ProjectNode)[];

/** queued / running 时仍以服务器为准的变体指针。 */
export const VARIANT_POINTER_FIELDS = [
  "currentVersionId",
  "activeVariantId",
  "output",
  "outputText",
  "outputRevision",
  "freshness",
] as const satisfies readonly (keyof ProjectNode)[];

/** 服务器权威字段。客户端 PUT 不得覆盖。 */
export const SERVER_AUTHORITATIVE_NODE_FIELDS = [
  "phase",
  "progress",
  "versions",
  "lastSuccessFingerprint",
  "lastAttemptFingerprint",
  "lastError",
  "runner",
  "lastRunId",
  "lastTaskId",
  "inputsChangedWhileRunning",
  "executionRevision",
] as const satisfies readonly (keyof ProjectNode)[];

export const MEDIA_REF_PATH_KEYS = [
  "relativePath",
  "firstFrameRelativePath",
  "lastFrameRelativePath",
  "coverRelativePath",
  "proxyRelativePath",
  "thumbRelativePath",
] as const;

export type SchemaIssueCode =
  | "schema_version_unsupported"
  | "schema_version_newer"
  | "forbidden_key"
  | "data_uri"
  | "invalid_rel_path"
  | "text_too_long"
  | "absolute_path"
  | "invalid_project"
  | "content_revision_conflict"
  | "working_copy_invariant";

export interface SchemaIssue {
  ok: false;
  httpStatus: 400 | 409 | 422;
  message: string;
  code: SchemaIssueCode;
}

/** 方案第 9.4 节。不要再定义 RunIntent。 */
export type CapabilityKind =
  | "text.generate"
  | "image.generate"
  | "video.generate"
  | "video.lipsync";

export const CAPABILITY_KINDS = [
  "text.generate",
  "image.generate",
  "video.generate",
  "video.lipsync",
] as const satisfies readonly CapabilityKind[];

export interface CapabilitySlotSpec {
  role: SlotRole;
  minCount: number;
  maxCount: number;
  accepts: MediaKind[];
  required: boolean;
}

export type ParamValueType = "int" | "float" | "string" | "bool" | "enum";

export interface CapabilityParamSpec {
  key: string;
  label: string;
  valueType: ParamValueType;
  required: boolean;
  userFacing: boolean;
  default?: string | number | boolean | null;
  min?: number;
  max?: number;
  enumValues?: string[];
}

export interface CapabilityDescriptor {
  kind: CapabilityKind;
  profileId: string;
  displayName: string;
  slots: CapabilitySlotSpec[];
  params: CapabilityParamSpec[];
  outputs: MediaKind[];
  implemented: boolean;
}

export type RunScope =
  | { type: "node"; nodeId: string }
  | { type: "downstream"; nodeId: string }
  | { type: "selection"; nodeIds: string[] };

export type TaskLane = "local" | "cloud";

export const TASK_LANES = ["local", "cloud"] as const satisfies readonly TaskLane[];

export interface RunRequest {
  projectId: string;
  scope: RunScope;
  /** 第 5.7 节：新鲜确认后才为 true；运行下游永远 false */
  force: boolean;
  clientRequestId: string;
}

export type RunPlanSkipReason =
  | "fresh"
  | "text_node"
  | "upstream_failed"
  | "upstream_not_run"
  | "not_implemented"
  | "missing_input"
  | "recipe_rejected"
  | "cancelled";

export interface RunPlan {
  nodes: Array<{
    nodeId: string;
    action: "run" | "skip";
    skipReason?: RunPlanSkipReason;
    message: string;
  }>;
  summary: string;
}

export type RunState = "running" | "succeeded" | "partial" | "failed" | "cancelled";

export const RUN_STATES = [
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
] as const satisfies readonly RunState[];

export type TaskState =
  | "queued"
  | "submitted"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled"
  | "interrupted";

export const TASK_STATES = [
  "queued",
  "submitted",
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
  "interrupted",
] as const satisfies readonly TaskState[];

export interface TaskRecord {
  taskId: string;
  runId: string;
  projectId: string;
  nodeId: string;
  lane: TaskLane;
  recipeId: string;
  recipeVersion: number;
  state: TaskState;
  fingerprintAtStart: string;
  variants: Array<{
    index: number;
    state: string;
    seedUsed: number | null;
    outputs: MediaRef[];
    error: UserFacingError | null;
    providerJobId: string | null;
  }>;
  error: UserFacingError | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunSnapshot {
  runId: string;
  projectId: string;
  scope: RunScope;
  force: boolean;
  state: RunState;
  plan: RunPlan;
  tasks: TaskRecord[];
  summary: string;
}

export type RunEvent =
  | { type: "run.planned"; runId: string; plan: RunPlan }
  | { type: "task.queued"; runId: string; taskId: string; nodeId: string }
  | { type: "task.submitted"; runId: string; taskId: string; providerJobId: string }
  | { type: "task.running"; runId: string; taskId: string }
  | { type: "task.progress"; runId: string; taskId: string; value: number; max: number }
  | { type: "task.progress.indeterminate"; runId: string; taskId: string; label: string }
  | { type: "variant.finished"; runId: string; taskId: string; nodeId: string; variant: Variant }
  | { type: "task.finished"; runId: string; taskId: string; state: TaskState; error: UserFacingError | null }
  | {
      type: "node.patch";
      runId: string | null;
      nodeId: string;
      contentRevision: number;
      executionRevision: number;
      patch: Partial<ProjectNode>;
    }
  | { type: "run.finished"; runId: string; state: RunState; summary: string };

export interface CapabilityService {
  listCapabilities(): Promise<CapabilityDescriptor[]>;
  listRecipes(): Promise<RecipeSummary[]>;
  planRun(request: RunRequest): Promise<RunPlan>;
  startRun(request: RunRequest): Promise<RunSnapshot>;
  getRun(runId: string): Promise<RunSnapshot | null>;
  cancelRun(runId: string): Promise<RunSnapshot>;
  cancelTask(taskId: string): Promise<TaskRecord>;
  retryFailed(runId: string): Promise<RunSnapshot>;
  resumeInterrupted(runId: string): Promise<RunSnapshot>;
  subscribe(runId: string): AsyncIterable<RunEvent>;
}

export interface LaneConfig {
  localConcurrency: 1;
  cloudConcurrency: number;
}

/** 方案第 9.6 节。本地并发是字面量 1，不是可配置项。 */
export const LANE_CONFIG = {
  localConcurrency: 1,
  cloudConcurrency: 2,
} as const satisfies LaneConfig;

export const COMFY_API_FORMAT = "comfy.api" as const;

export const PARAM_VALUE_TYPES = [
  "int",
  "float",
  "string",
  "bool",
  "enum",
] as const satisfies readonly ParamValueType[];

export type RecipeBindingMode = "concat" | "set" | "byOrder";

export interface RecipeBindingFrom {
  kind: "slot" | "param";
  role?: SlotRole;
  order?: number;
  key?: string;
}

export interface RecipeBinding {
  from: RecipeBindingFrom;
  to: { nodeId: string; input: string };
  mode: RecipeBindingMode;
  separator?: string;
}

export interface RecipeComfyPromptNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

export interface RecipeComfy {
  format: "comfy.api";
  prompt: Record<string, RecipeComfyPromptNode>;
  bindings: RecipeBinding[];
  outputNodeIds: string[];
}

export interface CloudVideoConstraints {
  upload: "multipart" | "presigned-put" | "remote-url" | "inline-bytes";
  firstFrame: "unsupported" | "optional" | "required";
  lastFrame: "unsupported" | "optional" | "required";
  referenceImageCount: { min: number; max: number };
  duration: { unit: "seconds" | "frames"; allowed?: number[]; min?: number; max?: number };
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

/** 方案第 9.5 节。安装目录只读 JSON；GET /recipes 仍只返回 RecipeSummary。 */
export interface RecipeFile {
  id: string;
  version: number;
  title: string;
  capability: CapabilityKind;
  profileId: string;
  lane: TaskLane;
  adapterId: string;
  requiresSecret: boolean;
  providerId?: string;
  slots: CapabilitySlotSpec[];
  params: CapabilityParamSpec[];
  comfy?: RecipeComfy;
  cloud?: {
    constraints: CloudVideoConstraints;
  };
}

export interface RecipeSummary {
  id: string;
  version: number;
  title: string;
  kind: CapabilityKind;
  profileId: string;
  lane: TaskLane;
  implemented: boolean;
  enabled: boolean;
  disabledReason?: string;
  requiresSecret: boolean;
  providerId?: string;
  params: CapabilityParamSpec[];
  slots: CapabilitySlotSpec[];
}

/** 工程与指纹里的种子存储值。界面显示「随机」，不要写中文进 params.seed。 */
export const RANDOM_SEED = "random" as const;
