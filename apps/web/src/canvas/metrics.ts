/** 方案第 9.2 节与阶段 2 布局 / 预算常量。外壳、命中、LOD、索引共用，禁止第二套魔法数。 */

export const TEXT_NODE_WIDTH = 280;
export const TEXT_NODE_HEIGHT = 180;

/** 方案第 9.2 节：header = 40，slotRow = 36。 */
export const HEADER = 40;
export const SLOT_ROW = 36;
export const GENERATION_HEADER = HEADER;
export const GENERATION_SLOT_ROW = SLOT_ROW;
export const GENERATION_ADD_SLOT_ROW = 28;
export const GENERATION_PREVIEW_MIN = 120;
export const GENERATION_VARIANT_STRIP = 72;
export const GENERATION_PAD = 8;
export const GENERATION_WIDTH = 320;
/** 方案第 9.2 节：输出锚点 = (width, 48)。 */
export const OUTPUT_ANCHOR_Y = 48;

export function outputAnchorLocal(width: number): { x: number; y: number } {
  return { x: width, y: OUTPUT_ANCHOR_Y };
}

export function generationNodeHeight(slotCount: number, variantCount: number): number {
  const variantStrip = variantCount === 0 ? 0 : GENERATION_VARIANT_STRIP;
  return (
    HEADER +
    slotCount * SLOT_ROW +
    GENERATION_ADD_SLOT_ROW +
    GENERATION_PREVIEW_MIN +
    variantStrip +
    GENERATION_PAD
  );
}

export function slotAnchorY(order: number): number {
  return HEADER + order * SLOT_ROW + SLOT_ROW / 2;
}

/** 空间索引格子边长（世界像素）。 */
export const GRID = 512;
export const CELL = GRID;

/** 远景：zoom < LOD_FAR。中景：LOD_FAR ≤ zoom < LOD_NEAR。近景：zoom ≥ LOD_NEAR。 */
export const LOD_FAR = 0.3;
export const LOD_NEAR = 0.8;

/** 同时挂载完整外壳硬顶。 */
export const MOUNT_CAP = 120;
/** 视口内带缩略图节点目标。 */
export const THUMB_CAP = 40;
/** 浏览器同时 decode 已签发缩略图的限额。 */
export const DECODE_CAP = 24;
export const DECODE = DECODE_CAP;
/** 近景挂载过扫描：视口再向外扩 0.5 个视口。 */
export const MOUNT_OVERSCAN = 0.5;
/** 远景色块屏幕宽度达到该值才画标题。 */
export const FAR_TITLE_MIN_SCREEN_PX = 64;

/** 复制粘贴各偏移 (COPY_OFFSET, COPY_OFFSET) 世界像素。 */
export const COPY_OFFSET = 24;
export const PASTE_OFFSET = COPY_OFFSET;
/** 分组框为子节点包围盒外扩（世界像素）。 */
export const GROUP_PAD = 24;
/** 点阵间距（屏幕像素）。 */
export const GRID_SPACING = 24;
export const AUTO_PAN_EDGE_PX = 24;

/** 与其他节点边或中心线吸附（屏幕像素）。 */
export const SNAP = 6;
export const ALIGN_SNAP_SCREEN_PX = SNAP;

/** 连接桩热区（CSS 像素）。P9：至少 24×24。 */
export const SLOT_HIT_CSS_PX = 24;
export const PORT = SLOT_HIT_CSS_PX;
/** 边命中容差（屏幕像素）。 */
export const EDGE_HIT = 8;
/** 连线时槽热区向四周扩展（屏幕像素）。 */
export const EXPAND = 12;
export const SLOT_HIT_EXPAND = EXPAND;
/** 抽出变体：离开变体条超过该屏幕像素才进入 extract。 */
export const EXTRACT_LEAVE_PX = 8;
/** 抽出幽灵相对格子的放大倍数。 */
export const EXTRACT_GHOST_SCALE = 1.04;
/** 非法连线回弹（P22）。prefers-reduced-motion 时为 0。 */
export const CONNECT_BOUNCE_MS = 180;
/** 重排时其它槽让位。prefers-reduced-motion 时手势写成 0。 */
export const REORDER_SHIFT_MS = 120;

/** 方案第 5.4 / F19：边色按角色。 */
export const SLOT_ROLE_STROKE = {
  prompt: "#8ab4ff",
  source_image: "#7bc67e",
  reference_image: "#e0b04a",
  style_reference: "#c58ae0",
  character_reference: "#e08a6a",
  mask: "#9aa0a6",
  first_frame: "#6ac0d0",
  last_frame: "#d07a9a",
  audio_reference: "#a08ad0",
} as const;

export const ZOOM_MIN = 0.08;
export const ZOOM_MAX = 2.5;
export const WHEEL_ZOOM_FACTOR = 1.08;
export const POINTER_THRESHOLD_PX = 4;

/** 框选：按下阈值同 POINTER_THRESHOLD_PX；默认完全落入，Alt 相交。 */
export const MARQUEE_THRESHOLD_PX = POINTER_THRESHOLD_PX;
export const MARQUEE_MODE_CONTAIN = "contain" as const;
export const MARQUEE_MODE_INTERSECT = "intersect" as const;
export type MarqueeMode = typeof MARQUEE_MODE_CONTAIN | typeof MARQUEE_MODE_INTERSECT;
export const MARQUEE_DEFAULT_MODE: MarqueeMode = MARQUEE_MODE_CONTAIN;

/** 命令栈深。超过丢掉最旧一条。 */
export const HISTORY_MAX = 100;
export const HISTORY_LIMIT = HISTORY_MAX;
/** 文本撤销合并窗口（已上屏后）。 */
export const TEXT_COALESCE_MS = 600;
/** 方向键轻推合并窗口。 */
export const NUDGE_COALESCE_MS = 400;

export const FIT_PADDING = 64;
export const CAMERA_ANIM_MS = 200;
export const MINIMAP_WIDTH = 180;
export const MINIMAP_HEIGHT = 120;
export const VARIANT_CELL_MIN = 64;
export const MINIMAP_NODE_THRESHOLD = 1000;

export const MAX_POINTERLESS_ANIMATION_MS = 400;
export const HEALTH_DEADLINE_MS = 5000;
export const VIEWPORT_PUT_IDLE_MS = 160;
export const HEALTH_POLL_MS = 2500;

export const BLOCK_COLOR = {
  text: "#3d4a5c",
  image: "#3e5c4a",
  video: "#5c4a3e",
  audio: "#4a3e5c",
  generationIdle: "#3a3a42",
  generationBusy: "#3a4a5c",
  generationFailed: "#5c3a3a",
} as const;

export const STALE_BAR = "#d4a017";
export const SELECTED_STROKE = "#9ec1ff";
