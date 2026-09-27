import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const desktopDir = join(dirname(scriptFile), "..");
const repoRoot = join(desktopDir, "..", "..");
const stage = join(desktopDir, "stage");
const canvas = join(stage, "canvas");

await rm(stage, { recursive: true, force: true });
await mkdir(join(stage, "node"), { recursive: true });
await mkdir(join(canvas, "packages", "schema"), { recursive: true });
await cp(join(desktopDir, "vendor", "node", "node.exe"), join(stage, "node", "node.exe"));
await cp(join(repoRoot, "apps", "backend", "src"), join(canvas, "apps", "backend", "src"), { recursive: true });
await cp(join(repoRoot, "apps", "web", "dist"), join(canvas, "apps", "web", "dist"), { recursive: true });
await cp(join(repoRoot, "recipes"), join(canvas, "recipes"), { recursive: true });
await cp(join(repoRoot, "packages", "schema", "src"), join(canvas, "packages", "schema", "src"), { recursive: true });
await writeFile(
  join(canvas, "package.json"),
  JSON.stringify(
    {
      name: "canvas-pack",
      private: true,
      type: "module",
      imports: {
        "@canvas/schema": "./packages/schema/src/index.ts",
      },
    },
    null,
    2,
  ),
);
