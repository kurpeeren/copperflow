// The hub's state in one SQLite file (node:sqlite, built into Node since 22.13 without a flag): users, invite codes,
// sessions, projects and the audit log. Every query is a prepared statement with bound values; nothing a person types
// is ever joined into SQL. Session ids and invite codes arrive here already hashed.
import { DatabaseSync, type StatementSync } from "node:sqlite"
import { sameSecret } from "./secrets.js"

export interface User {
  id: string
  email: string
  passwordHash: string
  created: number
  /** Set by the maintainer's reset: the user must choose a new password before anything else. */
  mustChangePassword: boolean
}

export interface Session {
  userId: string
  created: number
  expires: number
  lastSeen: number
}

export interface Project {
  id: string
  userId: string
  name: string
  created: number
}

export interface AuditEntry {
  time: number
  userId: string | null
  event: string
  address: string
  /** Never a password, cookie, code or ticket. */
  detail: string
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  hash TEXT PRIMARY KEY,
  created INTEGER NOT NULL,
  used_at INTEGER,
  used_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created INTEGER NOT NULL,
  UNIQUE (user_id, name)
);
CREATE TABLE IF NOT EXISTS devices (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);
CREATE TABLE IF NOT EXISTS workspace_sessions (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hub_session TEXT NOT NULL REFERENCES sessions(hash) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS workspace_sessions_user ON workspace_sessions(user_id);
CREATE TABLE IF NOT EXISTS user_cuts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time INTEGER NOT NULL,
  user_id TEXT,
  event TEXT NOT NULL,
  address TEXT NOT NULL,
  detail TEXT NOT NULL
);
`

type Row = Record<string, unknown>

/** Columns added after the first schema; fixed strings, never input. */
const COLUMNS: readonly [string, string][] = [
  ["users", "must_change INTEGER NOT NULL DEFAULT 0"],
  ["users", "deleted INTEGER NOT NULL DEFAULT 0"],
  ["projects", "deleted INTEGER NOT NULL DEFAULT 0"],
]

const userOf = (row: Row | undefined): User | undefined =>
  row
    ? { id: row.id as string, email: row.email as string, passwordHash: row.password as string, created: Number(row.created), mustChangePassword: Number(row.must_change) === 1 }
    : undefined
const projectOf = (row: Row | undefined): Project | undefined =>
  row ? { id: row.id as string, userId: row.user_id as string, name: row.name as string, created: Number(row.created) } : undefined

/** The email in the one form the store keeps: NFC, trimmed and lower-cased. */
export function normaliseEmail(email: string): string {
  return email.normalize("NFC").trim().toLowerCase()
}

/** The hub's state. One instance per data directory; it is not shared between processes. */
export class HubStore {
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()

  private constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(SCHEMA)
    for (const [table, column] of COLUMNS) this.addColumn(table, column)
  }

  /** Adds a column a database made by an earlier version lacks. */
  private addColumn(table: string, column: string): void {
    const name = column.split(" ")[0] as string
    const known = (this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).some((row) => row.name === name)
    if (!known) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`)
  }

  static open(file: string): HubStore {
    return new HubStore(file)
  }

  close(): void {
    this.db.close()
  }

  private sql(text: string): StatementSync {
    let statement = this.statements.get(text)
    if (!statement) {
      statement = this.db.prepare(text)
      this.statements.set(text, statement)
    }
    return statement
  }

  /** Runs `work` in one write transaction; anything it throws rolls it back. */
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = work()
      this.db.exec("COMMIT")
      return result
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }

  addInvite(codeHash: string, now: number): void {
    this.sql("INSERT INTO invites (hash, created) VALUES (?, ?)").run(codeHash, now)
  }

  /**
   * Creates the user and spends the invite code in one transaction. Undefined when the code is unknown or used, or
   * the email is taken: the caller answers all three alike.
   */
  signUp(codeHash: string, user: { id: string; email: string; passwordHash: string }, now: number): User | undefined {
    const email = normaliseEmail(user.email)
    return this.transaction(() => {
      const invite = this.sql("SELECT hash FROM invites WHERE hash = ? AND used_at IS NULL").get(codeHash) as Row | undefined
      if (!invite || !sameSecret(invite.hash as string, codeHash)) return undefined
      if (this.sql("SELECT 1 AS found FROM users WHERE email = ?").get(email)) return undefined
      this.sql("INSERT INTO users (id, email, password, created) VALUES (?, ?, ?, ?)").run(user.id, email, user.passwordHash, now)
      this.sql("UPDATE invites SET used_at = ?, used_by = ? WHERE hash = ?").run(now, user.id, codeHash)
      return { id: user.id, email, passwordHash: user.passwordHash, created: now, mustChangePassword: false }
    })
  }

  userByEmail(email: string): User | undefined {
    return userOf(this.sql("SELECT * FROM users WHERE email = ? AND deleted = 0").get(normaliseEmail(email)) as Row | undefined)
  }

  userById(id: string): User | undefined {
    return userOf(this.sql("SELECT * FROM users WHERE id = ? AND deleted = 0").get(id) as Row | undefined)
  }

  /** Marks the user deleted: from now on no route, session or proxy finds them, while their files are removed. */
  markUserDeleted(userId: string): void {
    this.sql("UPDATE users SET deleted = 1 WHERE id = ?").run(userId)
  }

  /** Marks the project deleted: from now on every route and the proxy answer 404 for it. */
  markProjectDeleted(userId: string, id: string): void {
    this.sql("UPDATE projects SET deleted = 1 WHERE id = ? AND user_id = ?").run(id, userId)
  }

  /** Sets the password; `mustChange` when the maintainer reset it and the user must choose a new one. */
  setPassword(userId: string, passwordHash: string, mustChange = false): void {
    this.sql("UPDATE users SET password = ?, must_change = ? WHERE id = ?").run(passwordHash, mustChange ? 1 : 0, userId)
  }

  /** Deletes the user with their sessions and project rows (the folders are the caller's to remove). */
  deleteUser(userId: string): void {
    this.sql("DELETE FROM users WHERE id = ?").run(userId)
  }

  createSession(idHash: string, userId: string, now: number, expires: number): void {
    this.sql("INSERT INTO sessions (hash, user_id, created, expires, last_seen) VALUES (?, ?, ?, ?, ?)").run(idHash, userId, now, expires, now)
  }

  /** The live session with this id hash; an expired one is deleted and not returned. */
  session(idHash: string, now: number): Session | undefined {
    const row = this.sql("SELECT * FROM sessions WHERE hash = ?").get(idHash) as Row | undefined
    if (!row || !sameSecret(row.hash as string, idHash)) return undefined
    if (Number(row.expires) <= now) {
      this.endSession(idHash)
      return undefined
    }
    return { userId: row.user_id as string, created: Number(row.created), expires: Number(row.expires), lastSeen: Number(row.last_seen) }
  }

  renewSession(idHash: string, now: number, expires: number): void {
    this.sql("UPDATE sessions SET last_seen = ?, expires = ? WHERE hash = ?").run(now, expires, idHash)
  }

  endSession(idHash: string): void {
    this.sql("DELETE FROM sessions WHERE hash = ?").run(idHash)
  }

  /** Ends every session of the user, or every one but `keepHash`. */
  endSessions(userId: string, keepHash?: string): void {
    if (keepHash === undefined) this.sql("DELETE FROM sessions WHERE user_id = ?").run(userId)
    else this.sql("DELETE FROM sessions WHERE user_id = ? AND hash <> ?").run(userId, keepHash)
    // A workspace session never outlives the hub sessions it came from.
    this.sql("DELETE FROM workspace_sessions WHERE user_id = ?").run(userId)
  }

  /** A workspace session made from the hub session `hubSession`; it ends with it (the row cascades). */
  createWorkspaceSession(idHash: string, userId: string, projectId: string, hubSession: string, expires: number): void {
    this.sql("INSERT INTO workspace_sessions (hash, user_id, project_id, hub_session, expires) VALUES (?, ?, ?, ?, ?)").run(idHash, userId, projectId, hubSession, expires)
  }

  /** The live workspace session with this id hash. */
  workspaceSession(idHash: string, now: number): { userId: string; projectId: string; hubSession: string } | undefined {
    const row = this.sql("SELECT * FROM workspace_sessions WHERE hash = ?").get(idHash) as Row | undefined
    if (!row || !sameSecret(row.hash as string, idHash)) return undefined
    if (Number(row.expires) <= now) {
      this.sql("DELETE FROM workspace_sessions WHERE hash = ?").run(idHash)
      return undefined
    }
    return { userId: row.user_id as string, projectId: row.project_id as string, hubSession: row.hub_session as string }
  }

  /** Whether a project with this id exists and is not being deleted (for the certificate check). */
  projectExists(id: string): boolean {
    return this.sql("SELECT 1 AS found FROM projects WHERE id = ? AND deleted = 0").get(id) !== undefined
  }

  /** Remembers a device the user signed in from; keeps the newest `max` per user. */
  addDevice(idHash: string, userId: string, now: number, max: number): void {
    this.transaction(() => {
      this.sql("INSERT INTO devices (hash, user_id, created) VALUES (?, ?, ?)").run(idHash, userId, now)
      this.sql("DELETE FROM devices WHERE user_id = ? AND hash NOT IN (SELECT hash FROM devices WHERE user_id = ? ORDER BY created DESC, rowid DESC LIMIT ?)").run(userId, userId, max)
    })
  }

  /** The user a device cookie belongs to, if it is still remembered. */
  deviceUser(idHash: string): string | undefined {
    const row = this.sql("SELECT * FROM devices WHERE hash = ?").get(idHash) as Row | undefined
    return row && sameSecret(row.hash as string, idHash) ? (row.user_id as string) : undefined
  }

  /**
   * Asks the running hub to cut the user's open streams and stop their workspaces (a maintainer command runs in another
   * process and cannot do it itself); the hub's sweep carries it out within 15 seconds.
   */
  requestCut(userId: string, now: number): void {
    this.sql("INSERT INTO user_cuts (user_id, created) VALUES (?, ?)").run(userId, now)
  }

  /** The users waiting to be cut, removed from the table as they are read. */
  takeCuts(): string[] {
    return this.transaction(() => {
      const users = (this.sql("SELECT DISTINCT user_id FROM user_cuts").all() as Row[]).map((row) => row.user_id as string)
      this.sql("DELETE FROM user_cuts").run()
      return users
    })
  }

  forgetDevice(idHash: string): void {
    this.sql("DELETE FROM devices WHERE hash = ?").run(idHash)
  }

  /** Forgets every device of the user (with the sessions, on sign-out, password change or reset). */
  forgetDevices(userId: string): void {
    this.sql("DELETE FROM devices WHERE user_id = ?").run(userId)
  }

  deviceCount(userId: string): number {
    return Number((this.sql("SELECT COUNT(*) AS n FROM devices WHERE user_id = ?").get(userId) as Row).n)
  }

  sessionCount(userId: string): number {
    return Number((this.sql("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(userId) as Row).n)
  }

  projects(userId: string): Project[] {
    return (this.sql("SELECT * FROM projects WHERE user_id = ? AND deleted = 0 ORDER BY name COLLATE NOCASE, id").all(userId) as Row[]).map((row) => projectOf(row) as Project)
  }

  /** Every project id of the user, deleted ones included (to stop their workspaces). */
  projectIds(userId: string): string[] {
    return (this.sql("SELECT id FROM projects WHERE user_id = ?").all(userId) as Row[]).map((row) => row.id as string)
  }

  /** The project only when it belongs to the user and is not being deleted. */
  project(userId: string, id: string): Project | undefined {
    return projectOf(this.sql("SELECT * FROM projects WHERE id = ? AND user_id = ? AND deleted = 0").get(id, userId) as Row | undefined)
  }

  projectCount(userId: string): number {
    return Number((this.sql("SELECT COUNT(*) AS n FROM projects WHERE user_id = ?").get(userId) as Row).n)
  }

  /** Inserts the project unless the user already has `maxProjects` or one of that name: count and insert in one transaction. */
  createProject(project: Project, maxProjects = Number.POSITIVE_INFINITY): "created" | "taken" | "full" {
    return this.transaction(() => {
      if (this.projectCount(project.userId) >= maxProjects) return "full"
      if (this.sql("SELECT 1 AS found FROM projects WHERE user_id = ? AND name = ?").get(project.userId, project.name)) return "taken"
      this.sql("INSERT INTO projects (id, user_id, name, created) VALUES (?, ?, ?, ?)").run(project.id, project.userId, project.name, project.created)
      return "created"
    })
  }

  renameProject(userId: string, id: string, name: string): "renamed" | "taken" | "missing" {
    try {
      const changed = this.sql("UPDATE projects SET name = ? WHERE id = ? AND user_id = ?").run(name, id, userId).changes
      return Number(changed) === 1 ? "renamed" : "missing"
    } catch (error) {
      if (/UNIQUE/.test((error as Error).message)) return "taken"
      throw error
    }
  }

  deleteProject(userId: string, id: string): boolean {
    return Number(this.sql("DELETE FROM projects WHERE id = ? AND user_id = ?").run(id, userId).changes) === 1
  }

  audit(entry: AuditEntry): void {
    this.sql("INSERT INTO audit (time, user_id, event, address, detail) VALUES (?, ?, ?, ?, ?)").run(entry.time, entry.userId, entry.event, entry.address, entry.detail)
  }

  /** The newest entries first. */
  auditLog(limit: number): AuditEntry[] {
    return (this.sql("SELECT * FROM audit ORDER BY id DESC LIMIT ?").all(limit) as Row[]).map((row) => ({
      time: Number(row.time),
      userId: (row.user_id as string | null) ?? null,
      event: row.event as string,
      address: row.address as string,
      detail: row.detail as string,
    }))
  }

  counts(): { users: number; projects: number; unusedInvites: number } {
    const n = (sql: string) => Number((this.sql(sql).get() as Row).n)
    return { users: n("SELECT COUNT(*) AS n FROM users"), projects: n("SELECT COUNT(*) AS n FROM projects"), unusedInvites: n("SELECT COUNT(*) AS n FROM invites WHERE used_at IS NULL") }
  }

  /** Removes expired sessions; returns how many. */
  sweepSessions(now: number): number {
    return Number(this.sql("DELETE FROM sessions WHERE expires <= ?").run(now).changes)
  }
}
