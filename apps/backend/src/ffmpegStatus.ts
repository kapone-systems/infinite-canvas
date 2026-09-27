import { spawn } from "node:child_process";

export type BinaryStatus = "missing" | "ok";

export type FfmpegProbeResult = {
  ffmpeg: BinaryStatus;
  ffprobe: BinaryStatus;
  ffmpegVersion: string | null;
};

function firstLine(text: string): string {
  const line = text.split(/\r?\n/, 1)[0];
  return line === undefined ? "" : line.trim();
}

function runVersion(command: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    let child;
    try {
      child = spawn(command, ["-version"], {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      finish(null);
      return;
    }

    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      out += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const line = firstLine(out);
      finish(line.length > 0 ? line : null);
    });
  });
}

export async function probeFfmpegFfprobe(options: {
  ffmpegPath?: string | null;
  ffprobePath?: string | null;
  timeoutMs?: number;
} = {}): Promise<FfmpegProbeResult> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const ffmpegCommand = options.ffmpegPath && options.ffmpegPath.length > 0 ? options.ffmpegPath : "ffmpeg";
  const ffprobeCommand = options.ffprobePath && options.ffprobePath.length > 0 ? options.ffprobePath : "ffprobe";
  const [ffmpegVersionLine, ffprobeVersionLine] = await Promise.all([
    runVersion(ffmpegCommand, timeoutMs),
    runVersion(ffprobeCommand, timeoutMs),
  ]);
  return {
    ffmpeg: ffmpegVersionLine === null ? "missing" : "ok",
    ffprobe: ffprobeVersionLine === null ? "missing" : "ok",
    ffmpegVersion: ffmpegVersionLine,
  };
}
