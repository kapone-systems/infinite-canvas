import { chmod, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const desktopDir = join(dirname(scriptFile), "..");
const repoRoot = join(desktopDir, "..", "..");
const stage = join(desktopDir, "stage");
const canvas = join(stage, "canvas");
const nodeName = process.platform === "linux" ? "node" : "node.exe";

await rm(stage, { recursive: true, force: true });
await mkdir(join(stage, "node"), { recursive: true });
const sourceNode = join(desktopDir, "vendor", "node", nodeName);
const destNode = join(stage, "node", nodeName);
try {
  await cp(sourceNode, destNode);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`缺少随包 Node：${sourceNode}。${message}`);
  process.exit(1);
}
if (process.platform === "linux") {
  await chmod(destNode, 0o755);
}
await cp(join(repoRoot, "apps", "backend", "src"), join(canvas, "apps", "backend", "src"), { recursive: true });
await cp(join(repoRoot, "apps", "web", "dist"), join(canvas, "apps", "web", "dist"), { recursive: true });
await cp(join(repoRoot, "recipes"), join(canvas, "recipes"), { recursive: true });
await emitSchemaPackage(
  join(repoRoot, "packages", "schema", "src"),
  join(canvas, "node_modules", "@canvas", "schema"),
);
await writeFile(
  join(canvas, "package.json"),
  `${JSON.stringify(
    {
      name: "canvas-pack",
      private: true,
      type: "module",
    },
    null,
    2,
  )}\n`,
);

async function listSchemaSources(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listSchemaSources(full)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** 安装目录没有仓库的 node_modules。schema 必须是普通 JS，且不能放在会被 --experimental-strip-types 拒绝的 .ts 里。 */
async function emitSchemaPackage(srcDir, destDir) {
  const files = await listSchemaSources(srcDir);
  if (files.length === 0) {
    console.error(`schema 源码是空的：${srcDir}`);
    process.exit(1);
  }
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const emitted = rewriteRelativeSpecifiers(stripTypeScriptTypes(source, { mode: "strip" }));
    if (emitted.includes(".ts\"") || emitted.includes(".ts'")) {
      console.error(`schema 编译结果仍引用 .ts：${file}`);
      process.exit(1);
    }
    const rel = relative(srcDir, file).replace(/\.ts$/, ".js");
    const dest = join(destDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, emitted);
  }
  await writeFile(
    join(destDir, "package.json"),
    `${JSON.stringify(
      {
        name: "@canvas/schema",
        private: true,
        type: "module",
        exports: { ".": "./index.js" },
      },
      null,
      2,
    )}\n`,
  );
}

function rewriteRelativeSpecifiers(code) {
  return code.replace(/((?:from|import)\s*\(?\s*["'])(\.{1,2}\/[^"']+?)\.ts(["'])/g, "$1$2.js$3");
}
