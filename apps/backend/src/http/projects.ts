import type { IncomingMessage, ServerResponse } from "node:http";
import { BACKEND_MESSAGES, USER_FACING } from "../messages.ts";
import { emptyTrash, listMissingBlobPaths } from "../media/recycle.ts";
import { maybePlantFixtureThumb } from "../media/fixtureThumb.ts";
import { asRecord, createNewProject, createResponseBody } from "../project/createProject.ts";
import type { ForbiddenLocationContext } from "../project/forbiddenLocations.ts";
import { openProjectFromPath } from "../project/openProject.ts";
import {
  persistViewport,
  saveAsResponse,
  saveOpenedProject,
  saveOpenedProjectAs,
} from "../project/saveProject.ts";
import { isDirty, parseCamera, type ProjectSession } from "../project/workingCopy.ts";
import { sendJson, sendWorkingCopyOk } from "./guard.ts";
import { handleIssueMediaTicket, type MediaTicketStore } from "./mediaTickets.ts";

export type ProjectsContext = {
  session: ProjectSession;
  forbidden: ForbiddenLocationContext;
  tickets?: MediaTicketStore;
  onProjectOpened?: () => void;
};

function noProject(res: ServerResponse): void {
  sendJson(res, 404, { message: USER_FACING.noProject });
}

export async function handleProjects(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: unknown,
  ctx: ProjectsContext,
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  const path = url.pathname;

  if (path === "/api/projects" && method === "POST") {
    const record = asRecord(body);
    if (record === null || typeof record.parentDir !== "string" || typeof record.name !== "string") {
      sendJson(res, 400, { message: BACKEND_MESSAGES.invalidProjectName });
      return true;
    }
    const result = await createNewProject(
      { parentDir: record.parentDir, name: record.name },
      ctx.session,
      ctx.forbidden,
    );
    if (!result.ok) {
      sendJson(res, result.status, { message: result.message });
      return true;
    }
    ctx.onProjectOpened?.();
    sendJson(res, 201, createResponseBody(result.opened));
    return true;
  }

  if (path === "/api/projects/open" && method === "POST") {
    const record = asRecord(body);
    const absolutePath = record === null ? undefined : record.absolutePath;
    const result = await openProjectFromPath(absolutePath, ctx.session, ctx.forbidden);
    if (!result.ok) {
      sendJson(res, result.status, { message: result.message });
      return true;
    }
    ctx.onProjectOpened?.();
    const payload: Record<string, unknown> = {
      absolutePath: result.opened.absolutePath,
      project: ctx.session.current?.project ?? result.opened.project,
      dirty: result.dirty,
    };
    if (result.message !== null) {
      payload.message = result.message;
    }
    payload.missingMedia = result.missingMedia;
    sendJson(res, 200, payload);
    return true;
  }

  if (path === "/api/projects/current" && method === "GET") {
    if (ctx.session.current === null) {
      noProject(res);
      return true;
    }
    ctx.onProjectOpened?.();
    const payload: Record<string, unknown> = {
      project: ctx.session.current.project,
      dirty: isDirty(ctx.session.current.project),
      absolutePath: ctx.session.current.absolutePath,
    };
    if (ctx.session.current.restoredFromAutosave) {
      payload.message = USER_FACING.restoredFromAutosave;
    } else if (ctx.session.current.openMessage) {
      payload.message = ctx.session.current.openMessage;
    }
    if (ctx.session.lastAutosaveError !== null) {
      payload.autosaveError = { message: ctx.session.lastAutosaveError };
    }
    try {
      payload.missingMedia = await listMissingBlobPaths(
        ctx.session.current.absolutePath,
        ctx.session.current.project,
      );
    } catch {
      payload.missingMedia = [];
    }
    sendJson(res, 200, payload);
    return true;
  }

  if (path === "/api/projects/current/trash/empty" && method === "POST") {
    if (ctx.session.current === null) {
      noProject(res);
      return true;
    }
    try {
      await emptyTrash(ctx.session.current.absolutePath);
    } catch {
      sendJson(res, 500, { message: BACKEND_MESSAGES.requestFailed });
      return true;
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (path === "/api/projects/current" && method === "PUT") {
    if (ctx.session.current === null) {
      noProject(res);
      return true;
    }
    const result = await saveOpenedProject(ctx.session, body);
    if (!result.ok) {
      sendJson(res, result.status, { message: result.message });
      return true;
    }
    sendJson(res, 200, {
      contentRevision: result.project.contentRevision,
      savedContentRevision: result.project.savedContentRevision,
    });
    return true;
  }

  if (path === "/api/projects/current/save-as" && method === "POST") {
    if (ctx.session.current === null) {
      noProject(res);
      return true;
    }
    const record = asRecord(body);
    if (record === null || typeof record.parentDir !== "string" || typeof record.name !== "string") {
      sendJson(res, 400, { message: BACKEND_MESSAGES.invalidProjectName });
      return true;
    }
    const result = await saveOpenedProjectAs(
      ctx.session,
      { parentDir: record.parentDir, name: record.name },
      ctx.forbidden,
    );
    if (!result.ok) {
      sendJson(res, result.status, { message: result.message });
      return true;
    }
    const opened = result.opened;
    if (opened === undefined) {
      sendJson(res, 500, { message: BACKEND_MESSAGES.requestFailed });
      return true;
    }
    sendJson(res, 201, saveAsResponse(opened));
    return true;
  }

  if (path === "/api/projects/current/viewport" && method === "PUT") {
    if (ctx.session.current === null) {
      noProject(res);
      return true;
    }
    const camera = parseCamera(body);
    if (camera === null) {
      sendJson(res, 400, { message: USER_FACING.viewportSaveFailed });
      return true;
    }
    const result = await persistViewport(ctx.session, camera);
    if (!result.ok) {
      sendJson(res, result.status, { message: result.message });
      return true;
    }
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return true;
  }

  if (path === "/api/projects/current/working-copy" && method === "PUT") {
    if (ctx.session.current === null) {
      noProject(res);
      return true;
    }
    const merged = ctx.session.applyWorkingCopy(body);
    if (!merged.ok) {
      sendJson(res, merged.httpStatus, { message: merged.message });
      return true;
    }
    if (ctx.session.current !== null) {
      await maybePlantFixtureThumb(ctx.session.current.absolutePath, merged.project);
    }
    sendWorkingCopyOk(res, {
      contentRevision: merged.project.contentRevision,
      executionRevisions: merged.executionRevisions,
    });
    return true;
  }

  if (path === "/api/projects/current/media-tickets" && ctx.tickets !== undefined) {
    return handleIssueMediaTicket(req, res, url, body, {
      session: ctx.session,
      tickets: ctx.tickets,
    });
  }

  if (path.startsWith("/api/projects")) {
    sendJson(res, 404, { message: BACKEND_MESSAGES.requestFailed });
    return true;
  }

  return false;
}
