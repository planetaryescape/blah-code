import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";

export interface SessionEvent {
  id: string;
  sessionId: string;
  kind: string;
  payload: unknown;
  createdAt: number;
}

export interface SessionSummary {
  id: string;
  name?: string;
  createdAt: number;
  lastEventAt: number | null;
  eventCount: number;
}

export function defaultSessionDbPath(): string {
  return path.join(os.homedir(), ".blah-code", "sessions.db");
}

export class SessionStore {
  private db: Database;
  private filePath: string;

  constructor(dbPath?: string) {
    const file = dbPath ?? defaultSessionDbPath();
    this.filePath = file;
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file, { create: true, strict: true });

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        name TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_session_created
      ON events(session_id, created_at);
    `);

    this.ensureSessionNameColumn();
  }

  private ensureSessionNameColumn(): void {
    const columns = this.db.query("PRAGMA table_info(sessions)").all() as Array<{
      name: string;
    }>;
    const hasName = columns.some((column) => column.name === "name");
    if (!hasName) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN name TEXT");
    }
  }

  createSession(): string {
    const id = nanoid();
    this.db.query("INSERT INTO sessions (id, created_at) VALUES (?, ?)").run(id, Date.now());
    return id;
  }

  appendEvent(sessionId: string, kind: string, payload: unknown): SessionEvent {
    const event: SessionEvent = {
      id: nanoid(),
      sessionId,
      kind,
      payload,
      createdAt: Date.now(),
    };

    this.db
      .query("INSERT INTO events (id, session_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(event.id, sessionId, kind, JSON.stringify(payload), event.createdAt);

    return event;
  }

  listEvents(sessionId: string): SessionEvent[] {
    const rows = this.db
      .query("SELECT id, session_id, kind, payload, created_at FROM events WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as Array<{
      id: string;
      session_id: string;
      kind: string;
      payload: string;
      created_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      kind: row.kind,
      payload: this.parsePayload(row.payload),
      createdAt: row.created_at,
    }));
  }

  private parsePayload(payload: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
      return { value: parsed };
    } catch {
      return { raw: payload };
    }
  }

  listSessions(limit = 20): SessionSummary[] {
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));

    const rows = this.db
      .query(
        `SELECT
          s.id AS id,
          s.name AS name,
          s.created_at AS created_at,
          MAX(e.created_at) AS last_event_at,
          COUNT(e.id) AS event_count
        FROM sessions s
        LEFT JOIN events e ON e.session_id = s.id
        GROUP BY s.id, s.name, s.created_at
        ORDER BY COALESCE(MAX(e.created_at), s.created_at) DESC
        LIMIT ?`,
      )
      .all(safeLimit) as Array<{
      id: string;
      name: string | null;
      created_at: number;
      last_event_at: number | null;
      event_count: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name ?? undefined,
      createdAt: row.created_at,
      lastEventAt: row.last_event_at,
      eventCount: row.event_count,
    }));
  }

  getSession(sessionId: string): SessionSummary | null {
    const row = this.db
      .query(
        `SELECT
          s.id AS id,
          s.name AS name,
          s.created_at AS created_at,
          MAX(e.created_at) AS last_event_at,
          COUNT(e.id) AS event_count
        FROM sessions s
        LEFT JOIN events e ON e.session_id = s.id
        WHERE s.id = ?
        GROUP BY s.id, s.name, s.created_at`,
      )
      .get(sessionId) as
      | {
          id: string;
          name: string | null;
          created_at: number;
          last_event_at: number | null;
          event_count: number;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      name: row.name ?? undefined,
      createdAt: row.created_at,
      lastEventAt: row.last_event_at,
      eventCount: row.event_count,
    };
  }

  updateSessionName(sessionId: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.db.query("UPDATE sessions SET name = ? WHERE id = ?").run(trimmed, sessionId);
  }

  getLastSessionId(): string | null {
    return this.listSessions(1)[0]?.id ?? null;
  }

  dbPath(): string {
    return this.filePath;
  }
}
