import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { USER_FACING } from "@canvas/schema";
import { COPY } from "../ui/copy.ts";
import { formatDuration } from "./formatDuration.ts";
import {
  audioRelativePath,
  audioTicketSrc,
  shouldMountAudioElement,
  shouldRequestAudioTicket,
} from "./audioPreview.ts";
import { planLod } from "./lod.ts";
import type { MediaRef } from "@canvas/schema";

const here = dirname(fileURLToPath(import.meta.url));
const audioSrc = readFileSync(join(here, "AudioNode.tsx"), "utf8");
const appSrc = readFileSync(join(here, "../App.tsx"), "utf8");
const gestureSrc = readFileSync(join(here, "gestures.ts"), "utf8");

function audioMedia(durationMs: number | null): MediaRef {
  return {
    kind: "audio",
    relativePath: "media/blobs/aa/hash.blob",
    contentHash: "a".repeat(64),
    byteSize: 44,
    mimeDetected: "audio/wav",
    width: null,
    height: null,
    durationMs,
    firstFrameRelativePath: null,
    lastFrameRelativePath: null,
    coverRelativePath: null,
    proxyRelativePath: null,
    thumbRelativePath: null,
  };
}

test("没有媒体只空状态；有媒体显示时长，空时长不是 0:00", () => {
  assert.equal(audioRelativePath(null), null);
  assert.equal(audioRelativePath({ ...audioMedia(null), kind: "image" }), null);
  assert.equal(audioRelativePath(audioMedia(null)), "media/blobs/aa/hash.blob");
  assert.equal(COPY.emptyAudio, "还没有音频");
  assert.equal(formatDuration(null), "时长未知");
  assert.equal(formatDuration(null), USER_FACING.durationUnknown);
  assert.equal(formatDuration(0), "时长未知");
  assert.notEqual(formatDuration(null), "0:00");
  assert.equal(formatDuration(1500), "0:02");
  assert.equal(audioSrc.includes("COPY.emptyAudio"), true);
  assert.equal(audioSrc.includes("formatDuration"), true);
  assert.equal(audioSrc.includes("0:00"), false);
});

test("刚拖入不同步时不要票据；选中且同步后才挂票据地址", () => {
  const path = "media/blobs/aa/hash.blob";
  assert.equal(
    shouldRequestAudioTicket({
      selected: true,
      needsWorkingCopySync: true,
      token: "tok",
      relativePath: path,
    }),
    false,
  );
  assert.equal(
    shouldRequestAudioTicket({
      selected: false,
      needsWorkingCopySync: false,
      token: "tok",
      relativePath: path,
    }),
    false,
  );
  assert.equal(
    shouldRequestAudioTicket({
      selected: true,
      needsWorkingCopySync: false,
      token: null,
      relativePath: path,
    }),
    false,
  );
  assert.equal(
    shouldRequestAudioTicket({
      selected: true,
      needsWorkingCopySync: false,
      token: "tok",
      relativePath: path,
    }),
    true,
  );
  assert.equal(audioTicketSrc("abc"), "/api/media-ticket/abc");
  assert.equal(audioTicketSrc("abc").startsWith("blob:"), false);
  assert.equal(audioTicketSrc("abc").startsWith("file:"), false);
  assert.equal(shouldMountAudioElement({ selected: true, needsWorkingCopySync: false, src: audioTicketSrc("abc") }), true);
  assert.equal(shouldMountAudioElement({ selected: false, needsWorkingCopySync: false, src: audioTicketSrc("abc") }), false);
  assert.equal(shouldMountAudioElement({ selected: true, needsWorkingCopySync: true, src: audioTicketSrc("abc") }), false);
  assert.equal(shouldMountAudioElement({ selected: true, needsWorkingCopySync: false, src: path }), false);
  assert.equal(shouldMountAudioElement({ selected: true, needsWorkingCopySync: false, src: "blob:abc" }), false);
});

test("音频节点源码没有波形、没有 autoplay，播放用 purpose=audio", () => {
  assert.equal(audioSrc.includes("autoplay"), false);
  assert.equal(audioSrc.includes("autoPlay"), false);
  assert.equal(audioSrc.includes("controls"), false);
  assert.equal(audioSrc.includes('className="btn btn-secondary"'), true);
  assert.equal(audioSrc.includes("COPY.playProxy"), true);
  assert.equal(audioSrc.includes("COPY.pauseAudio"), true);
  assert.equal(audioSrc.toLowerCase().includes("waveform"), false);
  assert.equal(audioSrc.includes("波形"), false);
  assert.equal(audioSrc.includes("createObjectURL"), false);
  assert.equal(audioSrc.includes("blob:"), false);
  assert.equal(audioSrc.includes("file://"), false);
  assert.equal(audioSrc.includes('purpose: "original"'), false);
  assert.equal(audioSrc.includes('purpose: "proxy"'), false);
  assert.equal(audioSrc.includes('purpose: "audio"'), true);
  assert.equal(audioSrc.includes("ThumbImage"), false);
  assert.equal(gestureSrc.includes("波形"), false);
  assert.equal(gestureSrc.toLowerCase().includes("waveform"), false);
  const audioAt = appSrc.indexOf('node.kind === "audio"');
  assert.equal(audioAt >= 0, true);
  const slice = appSrc.slice(audioAt, audioAt + 500);
  assert.equal(slice.includes("token={token}"), true);
  assert.equal(slice.includes("selected={selectedSet.has(node.id)}"), true);
  assert.equal(slice.includes("needsWorkingCopySync={snap.needsWorkingCopySync}"), true);
  assert.equal(appSrc.includes("addImportedAudio"), true);
  assert.equal(USER_FACING.notImplemented, "这一类还没接入。");
});

test("远景不挂外壳，音频只留在色块里", () => {
  const plan = planLod({
    camera: { x: 140, y: 48, zoom: 0.1 },
    viewport: { width: 800, height: 600 },
    nodes: [{ id: "a", x: 0, y: 0, width: 280, height: 96 }],
  });
  assert.equal(plan.band, "far");
  assert.deepEqual(plan.mountedIds, []);
  assert.equal(plan.blockIds.includes("a"), true);
});
