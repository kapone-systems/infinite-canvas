# 阶段 1 交付说明（工程地基与空画布）

- **日期：** 2026-09-24
- **性质：** 过程稿。不是主文件。进度、完成度、审查勾选只写在 [进度查询与工程审查](../进度查询与工程审查.md)；边界与验收句子以 [无限画布开发方案](../无限画布开发方案.md) 为准。
- **本文不改方案正文，也不改进度主文件。** 状态仍以进度文件第 2 节为准。
- **写法：** 单测结论只记本会话实际跑过的命令。GUI / 秒表 / Vite 代理 / 端口占用实查，本会话未跑，记「未跑」或沿用进度文件的「未观察」，不写成通过。

---

## 1. 一句话结论

阶段 1 的仓库切片已经落地：`apps/web`、`apps/backend`、`packages/schema` 有工程 HTTP、工作副本合并、文本节点、空状态主句和单测。本会话 `npm test` 83 通过、`npm run typecheck` 无诊断。

按进度文件，**当前阶段仍是「1 工程地基与空画布 / 进行中」**，`canSubmit=false`，`readyForReview=false`，审查清单未勾，**不能标待审查或已通过**。演示脚本 1–3 与预算 P25 / P26 / P27 仍未在真实浏览器观察。HTTP 夹具通过 ≠ GUI 通过。

---

## 2. 进度文件快照（原文对照）

摘自 `docs/进度查询与工程审查.md` 第 2、3、4、6、7、8、10 节（本会话阅读，未改该文件）：

| 项 | 进度文件中的值 | 出处 |
| --- | --- | --- |
| 文件更新日期 | 2026-09-24 | 第 2 节表 |
| 当前阶段 | **1 工程地基与空画布** | 第 2、3 节 |
| 当前阶段状态 | **进行中** | 第 2、3 节 |
| 上一已通过阶段 | 无 | 第 2 节 |
| 待审查阶段 | 无 | 第 2 节 |
| 必做阶段通过数 | 0 / 9 | 第 2 节 |
| 总功能已验收 | 0 | 第 2、4 节 |
| 仓库现状 | 已有 `apps/web`、`apps/backend`、`packages/schema`。阶段 1 代码已落地；演示脚本 GUI 未在真实浏览器走完，未达待审查 | 第 2 节 |
| F01–F06、F08–F09 | 进行中，完成度 75% | 第 4.1 节 |
| F07 | 进行中，完成度 70% | 第 4.1 节（空状态 / 后端未连上） |
| F10 起 | 未开始 / 0% | 第 4.2 节起 |
| 第 6 节阶段 1 审查清单 | 全部未勾 | 第 6 节 |
| 提交审查表 | 空 | 第 6 节 |
| 最新审查记录 | 2026-09-24「阶段 1 实现推进，未达待审查」；`canSubmit=false`，`readyForReview=false` | 第 7 节 |

线性轨道（进度第 2 节）：`[1 进行中] → [2 未开始] → …`。阶段 1 未通过之前，阶段 2 不得标进行中（允许空目录占位）。

---

## 3. 本会话实际执行的检查

### 3.1 `npm test`（进度第 7、8 节点名的那条，本会话重跑）

在工作区根目录 `D:\Program Files\work\zcode project\project 2` 执行：

```text
npm test
```

根 `package.json` 将其展开为：

```text
node --experimental-strip-types --test "apps/**/*.test.ts" "packages/**/*.test.ts"
```

本会话输出摘要：

```text
ℹ tests 83
ℹ suites 0
ℹ pass 83
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 981.806
```

与进度第 7 节「本会话 `npm test` 83 通过」一致。**这是本会话跑过的全量产品单测，不是抽一个文件代替。**

### 3.2 `npm run typecheck`（进度第 7 节点名，本会话重跑）

```text
npm run typecheck
```

展开为 `npm run typecheck --workspaces --if-present`。本会话依次执行：

- `@canvas/web`：`tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit`
- `@canvas/backend`：`tsc -p tsconfig.json --noEmit`
- `@canvas/schema`：`tsc -p tsconfig.json --noEmit`

无 TypeScript 诊断输出。视为退出 0。`tsconfig.base.json` 开了 `strict` 与 `noUncheckedIndexedAccess`。

### 3.3 本会话未跑（不得记通过）

| 检查 | 状态 | 说明 |
| --- | --- | --- |
| 真实浏览器走方案阶段 1 演示脚本 1–3 | **未跑** | 进度第 8 节已记未观察；本会话也未开 GUI、未用秒表 |
| P23 / P24 / P25 / P26 / P27 目视或秒表 | **未跑** | 同进度第 8 节 |
| Vite 开发服与 `/api` 代理（R12） | **未跑** | 进度第 9 节 R12「未核实」 |
| 本机 8787 / 5173 是否被占用（R6） | **未跑** | 进度第 9 节 R6「未检查」 |
| 长期 `npm run dev:backend` / `dev:web` 手工启动 | **未跑** | 单测里有 spawn 后端进程，不是人打开的演示切片 |
| 工作流 run 历史 | **未读到** | 本会话 `ListWorkflowRuns` 返回 capability gap，不以空历史代替 |

---

## 4. 方案阶段 1 范围落地（代码 + 本会话单测）

对照方案第 10 节阶段 1「范围」（`docs/无限画布开发方案.md` 约 1321 行）和第 15 节第一周拆解。

### 4.1 运行形态

| 范围项 | 落地 | 证据 |
| --- | --- | --- |
| 浏览器 + 只听 `127.0.0.1` 的 Node 后端 | 代码 + 单测 | `apps/backend/src/appData.ts:8-9` `LISTEN_HOST = "127.0.0.1"`；`createServer.ts` `listenLoopback` 绑该主机。本会话 `guard.test.ts`：「只绑 127.0.0.1；…」通过 |
| 不做纯静态页、不做壳 | 目录如此 | 有 `apps/web` + `apps/backend`；无 `apps/desktop`。前端 `vite.config.ts:6-8` 开发服 `host: "127.0.0.1"`、`port: 5173`、`strictPort: true` |
| 单实例锁 | 代码 + 单测 | `apps/backend/src/lock.ts:78-92`；本会话「同一数据目录第二把锁失败且不杀第一进程」「第二进程拿不到锁则退出，不杀持锁进程」通过 |
| 会话令牌进 URL 片段 | 代码 + 单测 | `token.ts:20-21` 打印 `http://127.0.0.1:${port}/#token=`；`main.ts:149` 启动后 `console.log` 该地址。本会话「终端打印含 #token= 的片段地址且令牌不进查询串」通过。前端只从 hash 读：`apps/web/src/session/token.ts:7-8` |
| Origin / Host 白名单 | 代码 + 单测 | `guard.ts:7-18` 四条 Origin、两条 Host。本会话 guard 测：错误 Origin 拒绝、无 Origin 的变更拒绝、查询串令牌无效、`Host: example.com` → 403 |
| `GET /health`，ffmpeg missing 仍 `ok` | 代码 + 单测 | `health.ts:14-22` 形状含 `ok: true`、`ffmpeg`/`ffprobe`、`ffmpegVersion`、`comfy: "unconfigured"`、`secretStore: "not-checked"`。本会话「GET /health 免令牌；ffmpeg missing 时仍 ok:true」通过 |
| 端口占用退出并打印方案第 6 节句子，不杀占用者 | 代码 + 单测 | `main.ts:150-155` + `userFacingMessages.ts:32-33`。本会话「端口占用则退出并打印方案句子，不杀占用者」通过 |
| `--serve-web` / 默认 dist 让终端地址能出页面 | 代码 + 单测 | `main.ts:25-42` `resolveWebRoot`：有 dist 则默认当静态根。本会话 `staticFiles.test.ts`：默认 dist 与 `--serve-web` 的 GET `/` 为 HTML；脚本含「还没有工程」「新建工程」；API 仍要令牌。进度第 8 节把这记成「2-静态 / 通过」，并写明「fetch 构建产物，不是浏览器渲染空状态」 |

Vite 配置了 `/api` 与 `/health` 代理（`vite.config.ts:13-23`，`ws: true`），**本会话未启动 Vite，R12 仍未核实。**

### 4.2 工程 HTTP（方案第 9.9 节）

路由在 `apps/backend/src/http/projects.ts`。本会话相关测试均通过：

| 接口 | 实现 | 本会话单测 |
| --- | --- | --- |
| `POST /api/projects` 201 | `projects.ts:34-50` | 「POST /api/projects 成功 201 并写出空 canvas.project.json」 |
| `POST /api/projects/open` | `projects.ts:53-70` | 路径不存在 404；未保存时打开另一路径 409；schema 太新 422；拷走后再打开 200 |
| `GET /api/projects/current` | `projects.ts:73-90` | 尚未打开 404，主句「还没有工程」 |
| `PUT /api/projects/current` 保存 | `projects.ts:93-107` 成功 200 | 忽略请求体 `nodes`，只写服务器工作副本；冲突 409 主句「这份工程在这次打开之后被写过。为避免覆盖，请另存为。」 |
| `POST /api/projects/current/save-as` | `projects.ts:110-135` 201 | 「POST save-as 换新目录和新 projectId」 |
| `PUT /api/projects/current/viewport` | `projects.ts:138-155` 成功 **204** | 「PUT viewport 写入相机且不改 contentRevision、不点亮 dirty」 |
| `PUT /api/projects/current/working-copy` | `projects.ts:158-173` 成功 **200**（方案表写 204，见第 7 节偏差） | 「PUT working-copy 按合并规则成功 200」；「假 phase=queued 不得被客户端 PUT 清掉」 |

禁止位置：磁盘根、用户主目录、应用数据目录（`forbiddenLocations` 单测 + HTTP 拒绝建在应用数据目录）。工程名按 Windows 规则过滤（本会话「Windows 工程名过滤」通过）。

原子写 + `.bak`：本会话「原子写保留 .bak 为上一份内容」通过。

### 4.3 工作副本合并（阶段 1 必有单测）

- 函数：`packages/schema/src/mergeWorkingCopy.ts`
- 字段表：`packages/schema/src/types.ts:238-285`（客户端权威 / 变体指针 / 服务器权威，与方案 9.9 一致）
- 本会话：`mergeWorkingCopy.test.ts`「phase=queued 时客户端 PUT idle 或省略 phase，合并后仍为 queued」；HTTP 层 `projects.workingCopy.test.ts`「假 phase=queued 不得被客户端 PUT 清掉」；`workingCopy.test.ts`「session.applyWorkingCopy 合并后 queued 仍在」

新节点即使客户端带 `phase=queued` 也落到 `idle`（`mergeWorkingCopy.ts:104-111`，对应单测通过）。

### 4.4 自动保存骨架（方案第 9.10 节）

- 间隔常量 `AUTOSAVE_DELAY_MS = 1000`（`workingCopy.ts:8`）
- 本会话：「结构编辑距上次内容修订默认 1 秒」；「防抖后写入 autosave 且不改 savedContentRevision / 正式文件」；「打开时更新的合法 autosave 载入并标脏『已从自动保存恢复。』」；「autosave 失败不改磁盘且返回可供界面展示的失败」

生成落地立刻写 autosave 是阶段 4，本阶段不宣称。

### 4.5 Schema 与密钥键

- 类型：`packages/schema/src/types.ts`（`format: "canvas-project"`，`schemaVersion: 1`，`nodes`/`edges`/`groups` 为 id 映射）
- 空工程：`createEmptyProject.ts:10-25`
- 正斜杠相对路径：`projectRelPath.test.ts` 本会话通过
- 拒密钥键名：`forbiddenKeys.ts:5-18`（含 `apiKey`）；保存路径 `saveProject.test.ts`「保存拒绝 apiKey 且磁盘不变」本会话通过
- `schemaVersion !== 1` 拒打开：`validateProject.test.ts`「schemaVersion 2 拒打开」「缺失拒打开」本会话通过
- 文本上限 100000：`textLimit.ts:3-7`；EditorStore / validateProject 单测本会话通过

### 4.6 前端壳、空状态、文本节点

主句集中在 `packages/schema/src/userFacingMessages.ts`，前端 `apps/web/src/ui/copy.ts` 用 `satisfies` 钉死，避免另写一套。本会话 EditorStore 测「阶段 1 主句与端口占用句可用」通过。

| 界面 | 主句 | 代码 |
| --- | --- | --- |
| 从未连上 / 无令牌 | 「本机服务没连上」+「重试连接」 | `DisconnectedPage.tsx:4-12`；`App.tsx:150-153` 健康检查失败或 token 为 null 进该屏。时限 `HEALTH_DEADLINE_MS = 5000`（`metrics.ts:31`） |
| 连接中 | 「正在连接本机服务」 | `DisconnectedPage.tsx:15-21` `ConnectingPage` |
| 后端在、尚未打开工程 | 「还没有工程」+「新建工程」「打开工程」 | `EmptyState.tsx:16-32`；`App.tsx:164-167` 对 `GET current` 404 进 `no-project`。**不是** empty-canvas，也不是内存工程（`store.clear()`） |
| 已打开且零节点 | 「画布是空的」；次句「从左侧加上文本节点」；主按钮「添加文本节点」；`data-empty` | `EmptyState.tsx:4-13`；`copy.ts:12-14` |
| 工具栏 | 只有「文本」 | `Toolbar.tsx:10-18`。本会话未在 GUI 点过；代码里没有生成入口 |
| 顶栏未保存 | 「未保存」 | `TopBar.tsx:17-18`；`COPY.unsaved` |
| 保存失败 | 「没能保存，修改还在。」 | `copy.ts:16`；HTTP 只读保存单测通过 |
| 中途断开横幅 | 「本机后端没连上。这个窗口里的修改还在，但现在不能保存，也不能生成。」 | `Banner.tsx:18-19` |
| 文本空占位 | 「还没有文字」 | `TextNode.tsx:55` |

文本闭环（代码 + 单测，**不是 GUI**）：

- 添加文本：默认 280×180，放在相机中心，立刻标脏并需要 PUT（`EditorStore.ts:161-188`，本会话对应测试通过）
- 已上屏且字符串变了才标脏；写「一只纸船」后 `outputRevision` +1（`EditorStore.test.ts:51-70`）
- 中文组字：`ime.ts` + `TextNode.tsx:63-77`；本会话 `ime.test.ts`「compositionstart 到 compositionend 之间不提交命令」通过，**不是真实输入法窗口**
- 超长拒绝主句「文本太长，没有放进节点。」

新建工程表单是粘贴父目录路径（`PastePathForm.tsx`，`copy.ts:46`「第一周只用粘贴，没有文件夹窗口」），与方案第 6 节一致。

### 4.7 相机、点阵、空间索引占位

- 公式：`coords.ts:24-34`，与方案第 9.1 节一致。本会话 `coords.test.ts`：「相机 x/y 为视口中心」「默认相机下世界原点在视口中心」「worldToScreen 与 screenToWorld 互逆」通过
- 平移：`gestures.ts` 空格/中键；`pointermove` 只改 live camera，松手才 `commitCamera`（注释写明禁止 pointermove 里 PUT）
- 滚轮：`gestures.ts:111-128` `preventDefault`（`passive: false`）；组字中不缩放
- **阶段 1 缩放锚在视口中心**（`coords.ts:57-58`），P7 指针锚留阶段 2。本会话「阶段 1 缩放只改 zoom、中心不变」通过
- 点阵：`DotGrid.tsx` + `Viewport.tsx:19-21`
- 空间索引空实现：`spatialIndex.ts:1-31` 标明「阶段 1 占位。阶段 2 再做格子 512」
- 视口单独可写不点亮未保存：EditorStore + viewport HTTP 单测本会话通过

阶段 2 目录尚未长出 `history.ts` / `hitTest.ts` / `EdgeCanvas.ts` / `lod.ts` / `fixtures/`。方案第 15 节允许第一周只留目录；**不得把阶段 2 手感写成已做。**

### 4.8 视觉最低线（仅代码观察，未目视）

`apps/web/src/styles.css`：

- 间距变量为 4 的倍数（`--space-1` … `--space-8`，`styles.css:19-25`）
- 字体家族一个 `--font`；字号四个 `--fs-1`…`--fs-4`（`styles.css:14-18`）
- 主按钮 hover / active / disabled / `:focus-visible`（`styles.css:110-157`）
- 禁用原因句：`TopBar.tsx:30-32`、`Toolbar.tsx:19-21`
- `prefers-reduced-motion` 去掉 animation / transition（`styles.css:380-387`）
- Vite `hmr.overlay: false`（`vite.config.ts:10-11`），对应演示 1「没有浏览器默认报错叠层」的代码侧，**GUI 未观察**

加载圈 `.loading-mark`（`styles.css:211-217`）是静态圆环，**没有 `@keyframes`**。P26 要的是 ≤5s 换成整页主句，不依赖转动画才出现按钮；`prefers-reduced-motion` 下按钮仍在 `DisconnectedPage`。这是代码观察，不代替 P26 秒表。

本会话在 `apps/`、`packages/` 搜索 `window.alert` / `window.confirm` / `xyflow` / `tldraw` / `konva` / `请先启动本机后端` / `electron` / `tauri`，未命中产品实现。`Banner` 的 `role="alert"` 是 ARIA，不是 `window.alert`。

---

## 5. 非范围（本阶段不宣称完成）

方案阶段 1「非范围」（约 1323 行）：生成节点、能力列表、连线语义、缩略图生成、图片拖入、Comfy 地址栏、密钥、分组、千节点、视频音频导入、票据签发。

代码侧：

- 工具栏没有生成按钮（`Toolbar.tsx`）
- 无 `apps/web/src/execution/`、无配方加载器、无 Comfy 客户端
- `schema` 的 `NodeKind` 含 `generation` 等（`types.ts:49`）以及 `metrics.ts` 的 `GENERATION_*` 常量，是给后续阶段用的类型/尺寸，**不是阶段 3/4 验收**
- 无 xyflow / tldraw 依赖（`apps/web/package.json` 只有 `react` / `react-dom` / `@canvas/schema`）

进度第 4.2 节起 F10 及以后均为未开始 0%。本文不把它们提前勾完。

---

## 6. 演示脚本与生效预算

方案阶段 1 演示脚本原文（`无限画布开发方案.md` 1352–1358 行）。进度第 8 节已有记录。**本会话未重走 GUI**；HTTP / 静态项与本会话 `npm test` 一致，故维持进度表的结论，不升级为 GUI 通过。

| 演示 | 预算 | 进度第 8 节结论 | 本会话 |
| --- | --- | --- | --- |
| 1 关掉后端再打开页面 | P26 | **未观察** | 未跑 GUI。代码有 5s 时限与整页主句，不能当秒表通过 |
| 2 从终端新地址打开 →「还没有工程」 | P25 | **未观察**（mustFix：GUI 未走通） | 未跑 GUI。自动化见下行 |
| 2-静态 GET `/` | — | 通过（fetch 构建页） | 本会话 `staticFiles.test.ts` 仍通过。**不是浏览器渲染** |
| 3 粘贴路径新建、写「一只纸船」、未保存、保存、刷新 | P25 | **未观察** | 未跑 GUI |
| 3-HTTP | — | 通过 | 本会话 `projects.current.test.ts`、`saveProject.test.ts` 仍通过。**不是 GUI 刷新** |
| 4 只读再保存 | — | 通过 | 本会话「目标文件只读则保存失败…」仍通过。HTTP 夹具，不是 GUI 点保存 |
| 5 JSON 加 `apiKey` 再保存 | — | 通过 | 本会话「保存拒绝 apiKey 且磁盘不变」仍通过 |
| 合并 | — | 通过（成功码 200 而非 204） | 本会话 merge / workingCopy HTTP 仍通过 |
| health | — | 通过 | 本会话 health 测仍通过 |
| Origin | — | 通过；未跑 Vite | 本会话 guard 测仍通过；Vite **未跑** |
| 端口占用 | — | 通过 | 本会话端口占用测仍通过（测的是临时空闲端口被占，不是本机 8787 实况） |
| 文本过长 | — | 通过 | 本会话 EditorStore / validateProject 仍通过 |
| 拷走 | — | 通过 | 本会话 `openProject.test.ts` 仍通过 |
| 组字 | — | 通过（不是真实输入法） | 本会话 `ime.test.ts` 仍通过 |
| 视口 | — | 通过 | 本会话 viewport / EditorStore 仍通过 |
| schema | — | 通过 | 本会话 validate / forbiddenKeys / projectRelPath 仍通过 |
| P23 | P23 | **未观察** | 未跑 |
| P24 | P24 | **未观察**（CSS 有规则，不得记通过） | 未跑 GUI |
| P27 | P27 | **未观察**（1280×720 与 150%） | 未跑 GUI |

生效预算（进度第 6 节：P23、P24 文字、P25、P26、P27）：**全部未观察。未观察 ≠ 通过。**

---

## 7. 已知偏差与遗留

### 7.1 必须交代、不挡把代码交出来、但挡「待审查」的

1. **GUI 演示 1–3 未走。** 进度第 7 节 leftover：「未在真实浏览器用秒表走完演示脚本」。没有 GUI 记录就不能把阶段改为待审查（进度第 5 节门槛 2、3）。
2. **P25 / P26 / P27 / P23 / P24 未观察。** 同上门槛 3。
3. **切片 mustFix 仍针对「从终端新地址打开」的 GUI。** 进度第 7 节：终端打印 `#token=`（`apps/backend/src/token.ts:20-21`）已有单测；「按演示脚本从终端新地址打开」的界面未走通。本会话静态 GET `/` 仍绿，**不得当成 GUI 通过**。打开时必须用打印出的带 `#token=` 的地址：无令牌时 `App.tsx:150-153` 会进「本机服务没连上」，即使后端已在跑。

### 7.2 与方案第 9.9 节表不一致、已写进代码的

**`PUT /api/projects/current/working-copy` 成功码是 200，不是表上的 204。**

- 方案表（`无限画布开发方案.md` 1265 行）：成功 `204 { contentRevision, executionRevisions? }`
- 实现（`apps/backend/src/http/projects.ts:168-172`）注释原文：「方案表写 204+JSON；Node http/fetch 会丢掉 204 正文，因此用 200 才能把 contentRevision 交给客户端。」
- 本会话测试按 **200** 断言（`projects.workingCopy.test.ts:22`）
- 视口 PUT 仍是 204（无正文），与方案一致
- 保存 PUT 成功 200，与方案一致

这是实现相对方案表的已知偏差。进度第 7、8 节已记录。**本文不改方案正文。** 进审查前要在提交表「遗留问题」写明，或先改方案表再审。

### 7.3 阶段 1 范围内、故意留给阶段 2 的

- 缩放锚在视口中心，不是指针（`coords.ts:57-58`）
- 空间索引空实现（`spatialIndex.ts`）
- 命令撤销整句 / 拖拽入栈：方案第 15 节「撤销可留到阶段 2」

### 7.4 风险登记（进度第 9 节，不挡阶段 1 开工，也不是本阶段通过）

| ID | 本文件状态 |
| --- | --- |
| R6 端口 8787 / 5173 占用 | 未检查（本会话未查） |
| R12 Vite 代理与令牌 | 未核实（本会话未跑 Vite） |
| R2 ffmpeg | 健康检查允许 missing；本会话探测测试允许 `ok` 或 `missing`，未单独打印本机 PATH |

---

## 8. 阶段 1 审查清单对照（第 6 节，现均为未勾）

进度文件清单一条都未勾。下面只说明**本会话能提供的证据类型**，不代替审查者勾选。

| 清单项 | 证据类型 | 能否当作审查通过 |
| --- | --- | --- |
| 关后端再打开：5s 内整页「本机服务没连上」+「重试连接」；无「请先启动本机后端。」；无默认报错叠层 | 代码存在；GUI **未观察** | 否 |
| 启动后端、尚未选文件夹：1s 内「还没有工程」+「新建工程」 | HTTP 404 主句有单测；GUI **未观察** | 否 |
| 粘贴路径新建后 empty-canvas 次句只有文本；主按钮「添加文本节点」 | 文案与组件存在；GUI **未观察** | 否 |
| 添加文本、写「一只纸船」、未保存、保存、刷新 | HTTP / EditorStore 有；GUI **未观察** | 否 |
| 中文输入法组字期间不提交 | ime 单测通过；**不是真实输入法** | 否（审查要看窗口） |
| 只读再保存：「没能保存，修改还在。」仍未保存 | HTTP 单测通过；GUI **未观察** | 部分（审查要看顶栏） |
| 工程 JSON 加 `apiKey` 再保存：拒绝，磁盘不变 | HTTP 单测通过 | 接近；仍建议审查者复现 |
| 文本超过 100000：「文本太长，没有放进节点。」 | 单测通过；GUI **未观察** | 部分 |
| 工程文件夹拷到另一路径仍能打开 | HTTP 单测通过 | 接近 |
| 带令牌打 `/api` 成功；换 Origin 被拒绝 | guard 单测通过；**未跑 Vite 代理** | 部分（R12） |
| 端口占用退出并打印第 6 节句子，不杀占用者 | 单测通过 | 接近 |
| 工作副本合并：假 `phase=queued` 不得被 PUT 清掉 | 单测通过（成功码 200 非 204） | 单测项可审；状态码偏差要交代 |
| ffmpeg missing 时 health 仍 `ok` | 单测通过 | 接近 |
| Tab 焦点环；1280×720 与 150% 主句不被裁切 | CSS 有 focus-visible；GUI **未观察** | 否 |
| `prefers-reduced-motion` 不依赖动画才出现按钮 | CSS 规则存在；GUI **未观察** | 否 |
| 工具栏只有「文本」；无生成、无假双击创建 | 代码如此；GUI **未观察** | 部分 |
| 视觉最低线；不用 `alert` / `confirm` | CSS / 搜索未发现 window.alert；GUI **未观察** | 否 |

进度第 5 节通用门槛：空的提交审查表不能审；演示记录有未观察；生效预算未观察；因此 **canSubmit=false** 仍然成立。

---

## 9. 预定功能 F01–F09（不改完成度）

完成度以进度第 4.1 节为准，本文不重填百分比。

| ID | 进度状态 | 本会话补充 |
| --- | --- | --- |
| F01 浏览器 + `127.0.0.1` 后端 | 进行中 75% | 单测绑 127.0.0.1 通过；未跑 Vite |
| F02 锁、令牌、Origin/Host、health | 进行中 75% | 对应单测通过 |
| F03 新建/打开/保存/另存为 | 进行中 75% | HTTP 单测通过；GUI 未观察 |
| F04 工作副本合并 | 进行中 75% | 合并单测通过；成功码 200≠204 |
| F05 视口单独可写 | 进行中 75% | 单测通过 |
| F06 自动保存骨架 | 进行中 75% | 单测通过；生成落地立刻 autosave 属阶段 4 |
| F07 空状态与未连上整页 | 进行中 70% | 组件与主句在；GUI 未观察，故低于其它项 |
| F08 文本节点、组字、已上屏即脏 | 进行中 75% | 单测通过；真实输入法未观察 |
| F09 工程可拷走（可无媒体） | 进行中 75% | HTTP 拷走单测通过 |

贯穿约束：C04 / C05 / C06 从阶段 1 抽查。C06（工程 JSON 无二进制、无密钥、无 Comfy 地址）有单测；C04 / C05 的目视项未观察。

---

## 10. 第一周对照（进度第 10 节）

进度文件第 10 节八条均已勾。那是「代码/单测是否落地」的周内漏项表，**全部勾完仍不能直接已通过**（该节原文）。与第 6 节审查清单未勾、第 8 节 GUI 未观察同时成立，并不矛盾。

第一周明确不做（进度第 10 节 / 方案第 15 节）：Comfy 客户端、配方填槽、缩略图编码、密钥、视频、xyflow/tldraw、Electron、文件夹 GUI 库。本会话未见这些被当成阶段 1 完成项。

---

## 11. 进入「待审查」还差什么

按进度第 5 节门槛，至少还要：

1. 在真实浏览器按方案阶段 1 演示脚本走完 1–5，把第 8 节里演示 1 / 2 / 3 从「未观察」改成通过或不通过（秒表看 P25 / P26）。
2. 至少观察一次 P23、P24 文字态、P27（1280×720 与系统 150%）。
3. 目视：工具栏只有「文本」、焦点环、四态按钮、无 `alert`/`confirm`、无「请先启动本机后端。」、无假的双击创建。
4. 决定工作副本 PUT 200 相对方案 204 的处理：改方案表，或改回 204 并保证客户端拿得到 `contentRevision`。
5. 填写第 6 节「提交审查」表（提交人/日期、演示记录表位置、遗留问题）。R12（Vite 代理）若审查要用开发切片，需在本机带令牌打 `/api` 并换 Origin 拒绝一次。
6. **开发者不能自己把「进行中」改成「已通过」。** 自检通过后只能改成「待审查」。

在上述完成之前，阶段 1 保持进行中。不要把阶段 2 标成进行中（空目录占位除外）。

---

## 12. 本会话命令与出处索引

| 做什么 | 命令或文件 | 结果 |
| --- | --- | --- |
| 全量单测 | 工作区根目录 `npm test` | 83 pass / 0 fail（见第 3.1 节摘要） |
| 类型检查 | `npm run typecheck` | 三 workspace `tsc --noEmit` 无诊断 |
| 进度与审查状态 | `docs/进度查询与工程审查.md` 第 2–10 节 | 阶段 1 进行中；清单未勾 |
| 阶段 1 范围与演示原文 | `docs/无限画布开发方案.md` 第 6、9.9、9.10、10（阶段 1）、11.1、12.4、15 节 | 对照用；本文未改 |
| 令牌 URL | `apps/backend/src/token.ts:20-21`，`main.ts:149` | `#token=` 片段 |
| 工作副本状态码 | `apps/backend/src/http/projects.ts:168-172` | 200 + JSON，非 204 |
| 空状态主句 | `packages/schema/src/userFacingMessages.ts`，`apps/web/src/ui/copy.ts`，`EmptyState.tsx`，`DisconnectedPage.tsx` | 与方案 11.1 阶段 1 句一致 |

**结论复述：** 阶段 1 实现与单测本会话为绿；按进度文件仍是进行中、未达待审查。交付的是可继续改和可给人审的切片，不是已通过的阶段。
