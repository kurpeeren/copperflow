// The hub's state in one SQLite file (node:sqlite, built into Node since 22.13 without a flag): users, invite codes,
// sessions, projects and the audit log. Every query is a prepared statement with bound values; nothing a person types
// is ever joined into SQL. Session ids and invite codes arrive here already hashed.
import { DatabaseSync, type StatementSync } from "node:sqlite"
import { actorOf, AuditGate, MANY_DISTINCT_LIMIT, type EndedCount } from "./audit-gate.js"

/** The longest detail of an `audit-count` row: room for 100 addresses and their counts. */
export const AUDIT_COUNT_DETAIL_MAX = 6_000
import { printable } from "./printable.js"
import { sameSecret } from "./secrets.js"
import { TokenStore } from "./token-store.js"

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

/** Sign-in sessions one user holds; a twenty-first ends their oldest. */
export const MAX_SESSIONS_PER_USER = 20
/** Workspace sessions one user holds for one project; a ninth ends their oldest for that project. */
export const MAX_WORKSPACE_SESSIONS = 8

/** Set after the version check, so a refused (newer) database is left exactly as it was. */
const PRAGMAS = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
`

/** The schema version this code writes (PRAGMA user_version). 0 is a database made before versions were kept. */
export const SCHEMA_VERSION = 4

/** Version 4: the index the count-based prune of routine rows walks, so it never reads the security rows between them. */
const SCHEMA_4 = `
CREATE INDEX IF NOT EXISTS audit_event ON audit(event, id);
`

/** The statement that deletes the oldest rows of one routine kind (a range scan of the audit_event index). */
export const ROUTINE_PRUNE_SQL = "DELETE FROM audit WHERE id IN (SELECT id FROM audit WHERE event = ? AND id < ? ORDER BY id LIMIT ?)"

/**
 * Version 3: the project names a certificate was approved for (on-demand TLS, `/_tls-ask`). No foreign keys: a row
 * outlives its project and counts against its owner until it is a week old (docs/hosted.md, "Workspaces on their own origins").
 */
const SCHEMA_3 = `
CREATE TABLE IF NOT EXISTS tls_names (
  project_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  approved_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tls_names_user ON tls_names(user_id, approved_at);
`

/** Version 2: the maintainer's requests to stop one workspace (`hub stop-workspace`), carried out by the hub's sweep. */
const SCHEMA_2 = `
CREATE TABLE IF NOT EXISTS workspace_stops (
  project_id TEXT PRIMARY KEY,
  created INTEGER NOT NULL
);
`

/** Version 1: the first schema, every step idempotent so a database from before versions were kept passes it too. */
const SCHEMA = `
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

export interface StoreCounts {
  users: number
  projects: number
  unusedInvites: number
}

function countsOf(db: DatabaseSync): StoreCounts {
  const n = (sql: string) => Number((db.prepare(sql).get() as Row).n)
  return { users: n("SELECT COUNT(*) AS n FROM users"), projects: n("SELECT COUNT(*) AS n FROM projects"), unusedInvites: n("SELECT COUNT(*) AS n FROM invites WHERE used_at IS NULL") }
}

/** Columns added after the first schema; fixed strings, never input. */
const COLUMNS: readonly [string, string][] = [
  ["users", "must_change INTEGER NOT NULL DEFAULT 0"],
  ["users", "deleted INTEGER NOT NULL DEFAULT 0"],
  ["projects", "deleted INTEGER NOT NULL DEFAULT 0"],]

const userOf = (row: Row | undefined): User | undefined =>
  row
    ? { id: row.id as string, email: row.email as string, passwordHash: row.password as string, created: Number(row.created), mustChangePassword: Number(row.must_change) === 1 }
    : undefined
const projectOf = (row: Row | undefined): Project | undefined =>
  row ? { id: row.id as string, userId: row.user_id as string, name: row.name as string, created: Number(row.created) } : undefined

/** A project name as compared for uniqueness: NFC and case-folded, so "Amp" and "amp" are one name. */
export function projectNameKey(name: string): string {
  return name.normalize("NFC").toLowerCase().normalize("NFC")
}

/** The email in the one form the store keeps: NFC, trimmed and lower-cased. */
export function normaliseEmail(email: string): string {
  return email.normalize("NFC").trim().toLowerCase()
}

/** The hub's state. One instance per data directory; it is not shared between processes. */
export class HubStore {
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  /** Personal access tokens, OAuth clients, grants and their tokens (token-store.ts). */
  readonly tokens: TokenStore
  /** The one rule every audit row passes (audit-gate.ts). */
  private readonly gate: AuditGate

  private constructor(file: string, gate: AuditGate) {
    this.gate = gate
    this.db = new DatabaseSync(file)
    try {
      // Waiting for a lock changes nothing in the file; everything else waits until the version is known to be ours.
      this.db.exec("PRAGMA busy_timeout = 5000")
      this.refuseNewer()
      this.db.exec(PRAGMAS)
      this.migrate()
    } catch (error) {
      this.db.close()
      throw error
    }
    this.tokens = new TokenStore(this.db)
  }

  /**
   * Brings the schema to SCHEMA_VERSION: refuses a database from a newer version (changing nothing), and runs the
   * additive steps an older one lacks, in order, in one transaction with the new version number.
   */
  private version(): number {
    return Number((this.db.prepare("PRAGMA user_version").get() as Row).user_version)
  }

  private refuseNewer(): void {
    const version = this.version()
    if (version > SCHEMA_VERSION) {
      throw new Error(
        `hub.db was written by a newer copperflow (schema ${version}; this one knows up to ${SCHEMA_VERSION}). Nothing was changed. Run the newer copperflow, or restore the backup taken before the upgrade; before every upgrade, take one with \`copperflow hub backup --data <dir> --to <file>\`.`,
      )
    }
  }

  private migrate(): void {
    if (this.version() === SCHEMA_VERSION) return
    this.transaction(() => {
      // Read again under the write lock: another process may have migrated it meanwhile.
      const version = this.version()
      if (version >= SCHEMA_VERSION) return
      if (version < 1) {
        this.db.exec(SCHEMA)
        for (const [table, column] of COLUMNS) this.addColumn(table, column)
      }
      if (version < 2) this.db.exec(SCHEMA_2)
      if (version < 3) this.db.exec(SCHEMA_3)
      if (version < 4) this.db.exec(SCHEMA_4)
      // A fixed number, never input.
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    })
  }

  /** Adds a column a database made by an earlier version lacks. */
  private addColumn(table: string, column: string): void {
    const name = column.split(" ")[0] as string
    const known = (this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).some((row) => row.name === name)
    if (!known) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`)
  }

  static open(file: string, options: { gate?: AuditGate } = {}): HubStore {
    return new HubStore(file, options.gate ?? new AuditGate())
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

  /** Whether the invite code (its hash) exists and is unused: signing up checks this before it hashes a password. */
  inviteLive(codeHash: string): boolean {
    const invite = this.sql("SELECT hash FROM invites WHERE hash = ? AND used_at IS NULL").get(codeHash) as Row | undefined
    return invite !== undefined && sameSecret(invite.hash as string, codeHash)
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

  /** Users marked deleted whose rows (and folders) are still to be removed: the running hub finishes them. */
  deletedUsers(): string[] {
    return (this.sql("SELECT id FROM users WHERE deleted = 1").all() as Row[]).map((row) => row.id as string)
  }

  /** Projects marked deleted whose rows are still there: the running hub finishes their removal. */
  deletedProjects(): { id: string; userId: string }[] {
    return (this.sql("SELECT id, user_id FROM projects WHERE deleted = 1").all() as Row[]).map((row) => ({ id: row.id as string, userId: row.user_id as string }))
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

  /** Starts a session; the user keeps their newest MAX_SESSIONS_PER_USER (the oldest end, with their workspace sessions). */
  createSession(idHash: string, userId: string, now: number, expires: number): void {
    this.transaction(() => {
      this.sql("INSERT INTO sessions (hash, user_id, created, expires, last_seen) VALUES (?, ?, ?, ?, ?)").run(idHash, userId, now, expires, now)
      this.sql("DELETE FROM sessions WHERE user_id = ? AND hash NOT IN (SELECT hash FROM sessions WHERE user_id = ? ORDER BY created DESC, rowid DESC LIMIT ?)").run(userId, userId, MAX_SESSIONS_PER_USER)
    })
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
    this.transaction(() => {
      this.sql("INSERT INTO workspace_sessions (hash, user_id, project_id, hub_session, expires) VALUES (?, ?, ?, ?, ?)").run(idHash, userId, projectId, hubSession, expires)
      // The newest MAX_WORKSPACE_SESSIONS for this user and project stay; a ninth ends the oldest.
      this.sql("DELETE FROM workspace_sessions WHERE user_id = ? AND project_id = ? AND hash NOT IN (SELECT hash FROM workspace_sessions WHERE user_id = ? AND project_id = ? ORDER BY rowid DESC LIMIT ?)").run(
        userId,
        projectId,
        userId,
        projectId,
        MAX_WORKSPACE_SESSIONS,
      )
    })
  }

  /** Workspace sessions the user holds for the project (live or not yet swept). */
  workspaceSessionCount(userId: string, projectId: string): number {
    return Number((this.sql("SELECT COUNT(*) AS n FROM workspace_sessions WHERE user_id = ? AND project_id = ?").get(userId, projectId) as Row).n)
  }

  /** Removes expired workspace sessions; returns how many. */
  sweepWorkspaceSessions(now: number): number {
    return Number(this.sql("DELETE FROM workspace_sessions WHERE expires <= ?").run(now).changes)
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

  /** The owner of a project that exists and is not being deleted, or undefined (for the certificate check). */
  projectOwner(id: string): string | undefined {
    const row = this.sql("SELECT user_id FROM projects WHERE id = ? AND deleted = 0").get(id) as Row | undefined
    return row ? (row.user_id as string) : undefined
  }

  /** Whether a certificate was approved for this project's name. */
  tlsNameKnown(projectId: string): boolean {
    return this.sql("SELECT 1 AS found FROM tls_names WHERE project_id = ?").get(projectId) !== undefined
  }

  /** Whether any project name was ever approved (a deployment with a wildcard certificate has none). */
  tlsNamesExist(): boolean {
    return this.sql("SELECT 1 AS found FROM tls_names LIMIT 1").get() !== undefined
  }

  /** Whether another name could be approved for `userId` at `now`: under `perUser` of their own and `hubWide` in all, within `windowMs`. */
  tlsRoom(userId: string, now: number, windowMs: number, perUser: number, hubWide: number): boolean {
    const since = now - windowMs
    const mine = Number((this.sql("SELECT COUNT(*) AS n FROM tls_names WHERE user_id = ? AND approved_at > ?").get(userId, since) as Row).n)
    const all = Number((this.sql("SELECT COUNT(*) AS n FROM tls_names WHERE approved_at > ?").get(since) as Row).n)
    return mine < perUser && all < hubWide
  }

  /**
   * Approves the project's name when it has a row already (renewals cost nothing), or when both budgets have room,
   * and records it; count and insert in one transaction. "refused" inserts nothing.
   */
  tlsApprove(projectId: string, userId: string, now: number, windowMs: number, perUser: number, hubWide: number): "known" | "approved" | "refused" {
    return this.transaction(() => {
      if (this.tlsNameKnown(projectId)) return "known"
      if (!this.tlsRoom(userId, now, windowMs, perUser, hubWide)) return "refused"
      this.sql("INSERT INTO tls_names (project_id, user_id, approved_at) VALUES (?, ?, ?)").run(projectId, userId, now)
      return "approved"
    })
  }

  /** Removes rows older than `olderThan` whose project no longer exists; returns how many. */
  pruneTlsNames(olderThan: number): number {
    return Number(this.sql("DELETE FROM tls_names WHERE approved_at < ? AND project_id NOT IN (SELECT id FROM projects)").run(olderThan).changes)
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

  /** The maintainer's request to stop one project's workspace (`hub stop-workspace`), for the running hub's sweep. */
  requestStop(projectId: string, now: number): void {
    this.sql("INSERT OR REPLACE INTO workspace_stops (project_id, created) VALUES (?, ?)").run(projectId, now)
  }

  /** The workspaces waiting to be stopped, oldest request first; each is removed by clearStop once it is done. */
  stopRequests(): string[] {
    return (this.sql("SELECT project_id FROM workspace_stops ORDER BY created, project_id").all() as Row[]).map((row) => row.project_id as string)
  }

  clearStop(projectId: string): void {
    this.sql("DELETE FROM workspace_stops WHERE project_id = ?").run(projectId)
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
      if (this.nameTaken(project.userId, project.name)) return "taken"
      this.sql("INSERT INTO projects (id, user_id, name, created) VALUES (?, ?, ?, ?)").run(project.id, project.userId, project.name, project.created)
      return "created"
    })
  }

  /** Whether another of the user's projects (deleted ones included) has this name after NFC and case folding. */
  private nameTaken(userId: string, name: string, exceptId?: string): boolean {
    const key = projectNameKey(name)
    return (this.sql("SELECT id, name FROM projects WHERE user_id = ?").all(userId) as Row[]).some((row) => row.id !== exceptId && projectNameKey(row.name as string) === key)
  }

  renameProject(userId: string, id: string, name: string): "renamed" | "taken" | "missing" {
    return this.transaction(() => {
      if (this.nameTaken(userId, name, id)) return "taken"
      try {
        const changed = this.sql("UPDATE projects SET name = ? WHERE id = ? AND user_id = ?").run(name, id, userId).changes
        return Number(changed) === 1 ? "renamed" : "missing"
      } catch (error) {
        if (/UNIQUE/.test((error as Error).message)) return "taken"
        throw error
      }
    })
  }

  deleteProject(userId: string, id: string): boolean {
    return Number(this.sql("DELETE FROM projects WHERE id = ? AND user_id = ?").run(id, userId).changes) === 1
  }

  /**
   * The one function every audit row goes through. The rule (audit-gate.ts): per (kind, actor) the first 20 events of a
   * 15-minute window are written in full, the 21st writes one `audit-summarised` row, later ones are only counted and the
   * sweep (or an orderly stop) writes one `audit-count` row when the window ends. Nothing is refused and nothing is lost.
   */
  audit(entry: AuditEntry): void {
    const { actor, isUser } = actorOf(entry.userId, entry.address)
    const decided = this.gate.decide(entry.event, actor, isUser, entry.time)
    for (const done of decided.ended) this.writeCount(done, entry.time)
    if (decided.verdict === "write") this.insertAudit(entry)
    else if (decided.verdict === "summarise") {
      const merged = decided.summaryActor !== actor
      this.insertAudit({
        time: entry.time,
        userId: isUser && !merged ? entry.userId : null,
        event: "audit-summarised",
        address: merged ? "many" : entry.address,
        detail: `kind=${entry.event} actor=${decided.summaryActor}${merged ? ` window=${new Date(decided.window).toISOString()}` : ""}`,
      })
    }
  }

  /** Every text field goes through `printable`: a detail may quote a name a person chose or an engine's output. */
  private insertAudit(entry: AuditEntry, detailMax = 400): void {
    this.sql("INSERT INTO audit (time, user_id, event, address, detail) VALUES (?, ?, ?, ?, ?)").run(entry.time, entry.userId, printable(entry.event, 80), printable(entry.address, 80), printable(entry.detail, detailMax))
  }

  private writeCount(done: EndedCount, now: number): void {
    const from = new Date(done.from).toISOString()
    const to = new Date(done.to).toISOString()
    let detail = `kind=${done.kind} actor=${done.actor} n=${done.count}`
    if (done.top) {
      // `many` keeps who did it as far as bounded storage allows: the distinct addresses and the busiest ones.
      detail += ` distinct=${done.moreDistinctThanLimit ? "more than " : ""}${done.moreDistinctThanLimit ? MANY_DISTINCT_LIMIT : done.distinct} from=${from} to=${to} top=`
      const room = AUDIT_COUNT_DETAIL_MAX - detail.length
      let list = ""
      for (const [address, n] of done.top) {
        const item = `${list === "" ? "" : ","}${address}:${n}`
        if (list.length + item.length > room) break
        list += item
      }
      detail += list
    } else detail += ` from=${from} to=${to}`
    this.insertAudit({ time: now, userId: done.isUser ? done.actor : null, event: "audit-count", address: done.isUser ? "hub" : done.actor, detail }, AUDIT_COUNT_DETAIL_MAX)
  }

  /**
   * Writes the `audit-count` rows of windows that ended by `now` (every pending one with `force`, on an orderly stop).
   * Returns how many rows it wrote. A kill loses only the counts of windows still open.
   */
  flushAuditCounts(now: number, force = false): number {
    const ended = this.gate.ended(now, force)
    for (const done of ended) this.writeCount(done, now)
    return ended.length
  }

  /** Whether the log holds more than `maxRows` rows (ids only rise, so their span bounds the count: count exactly only when it could be over). */
  auditOverCap(maxRows: number): boolean {
    const first = this.sql("SELECT MIN(id) AS id FROM audit").get() as Row
    const last = this.sql("SELECT MAX(id) AS id FROM audit").get() as Row
    if (first.id === null || Number(last.id) - Number(first.id) < maxRows) return false
    return this.auditRowCount() > maxRows
  }

  auditRowCount(): number {
    return Number((this.sql("SELECT COUNT(*) AS n FROM audit").get() as Row).n)
  }

  /**
   * Deletes at most `batch` audit rows in one statement: first rows of any kind written before `cutoff` (the only rule
   * that deletes a security event), else, when the log holds more than `maxRows`, the oldest rows of the `routine`
   * kinds only (and only when `checkCount`, which the caller allows every few minutes). Returns how many went (0 when
   * nothing is left that may be pruned).
   */
  pruneAuditBatch(cutoff: number, maxRows: number, batch: number, routine: readonly string[], checkCount = true): number {
    // Rows are written in time order, so the first row tells whether anything is old without scanning the table. (A clock
    // that stepped back leaves later rows with older times until the first row ages out; the count rule still bounds it.)
    const first = this.sql("SELECT id, time FROM audit ORDER BY id LIMIT 1").get() as Row | undefined
    if (!first) return 0
    if (Number(first.time) < cutoff) {
      return Number(this.sql("DELETE FROM audit WHERE id IN (SELECT id FROM audit WHERE time < ? ORDER BY id LIMIT ?)").run(cutoff, batch).changes)
    }
    if (!checkCount || !this.auditOverCap(maxRows) || routine.length === 0) return 0
    const over = this.auditRowCount() - maxRows
    // The routine kind with the oldest row goes first, and only below the next kind's oldest row, so the order across
    // kinds stays exact while every delete is a range scan of the audit_event index, never of the security rows.
    const oldest = routine
      .map((kind) => ({ kind, id: (this.sql("SELECT MIN(id) AS id FROM audit WHERE event = ?").get(kind) as Row).id as number | null }))
      .filter((entry): entry is { kind: string; id: number } => entry.id !== null)
      .sort((a, b) => a.id - b.id)
    const [head, next] = oldest
    if (!head) return 0
    return Number(this.sql(ROUTINE_PRUNE_SQL).run(head.kind, next?.id ?? Number.MAX_SAFE_INTEGER, Math.min(batch, over)).changes)
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

  counts(): StoreCounts {
    return countsOf(this.db)
  }

  /**
   * A consistent copy of the whole database in `file`, taken online with `VACUUM INTO` (one read transaction, so a
   * write in progress is either wholly in it or not at all). `file` must not exist or be empty.
   */
  backupTo(file: string): void {
    this.db.prepare("VACUUM INTO ?").run(file)
  }

  /** Opens a backup read-only, checks its integrity and counts it; throws when it is damaged. */
  static checkBackup(file: string): StoreCounts {
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      const check = db.prepare("PRAGMA integrity_check").get() as Row
      if (check.integrity_check !== "ok") throw new Error(`the backup ${file} failed its integrity check`)
      return countsOf(db)
    } finally {
      db.close()
    }
  }

  /** Removes expired sessions; returns how many. */
  sweepSessions(now: number): number {
    return Number(this.sql("DELETE FROM sessions WHERE expires <= ?").run(now).changes)
  }
}
