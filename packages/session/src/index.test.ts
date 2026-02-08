import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "./index";

function makeDbPath(name: string): string {
  return path.join(os.tmpdir(), `blah-code-${name}-${Date.now()}-${Math.random()}.db`);
}

describe("SessionStore", () => {
  const paths: string[] = [];

  afterEach(() => {
    for (const dbPath of paths.splice(0, paths.length)) {
      rmSync(dbPath, { force: true });
    }
  });

  test("lists sessions by latest activity and returns last session id", async () => {
    const dbPath = makeDbPath("sessions");
    paths.push(dbPath);

    const store = new SessionStore(dbPath);
    const older = store.createSession();
    await Bun.sleep(2);
    const newer = store.createSession();

    await Bun.sleep(5);
    store.appendEvent(older, "assistant", { text: "bump older to top" });

    const sessions = store.listSessions(10);
    expect(sessions[0]?.id).toBe(older);
    expect(sessions[1]?.id).toBe(newer);
    expect(store.getLastSessionId()).toBe(older);
  });

  test("updates and returns session name", () => {
    const dbPath = makeDbPath("session-name");
    paths.push(dbPath);

    const store = new SessionStore(dbPath);
    const sessionId = store.createSession();
    store.updateSessionName(sessionId, "  Repo onboarding  ");

    const session = store.getSession(sessionId);
    expect(session?.name).toBe("Repo onboarding");
    expect(store.listSessions(1)[0]?.name).toBe("Repo onboarding");
  });

  test("listEvents survives malformed payload rows", () => {
    const dbPath = makeDbPath("bad-payload");
    paths.push(dbPath);

    const store = new SessionStore(dbPath);
    const sessionId = store.createSession();
    const db = new Database(dbPath, { create: false, strict: true });
    db.query("INSERT INTO events (id, session_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("bad-event", sessionId, "assistant", "{not-json", Date.now());
    db.close();

    const events = store.listEvents(sessionId);
    expect(events.length).toBe(1);
    expect(events[0]?.payload).toEqual({ raw: "{not-json" });
  });
});
