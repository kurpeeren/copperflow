// The agent's credentials in the hub's database: personal access tokens, OAuth clients (dynamic registration), grants
// (one per person and client they allowed) and the grant's access and refresh tokens. Every token arrives here already
// hashed; no row ever holds a token itself. Every query is a prepared statement with bound values.
import type { DatabaseSync, StatementSync } from "node:sqlite"
import { sameSecret } from "./secrets.js"

export const TOKEN_SCHEMA = `
CREATE TABLE IF NOT EXISTS personal_tokens (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created INTEGER NOT NULL,
  last_used INTEGER
);
CREATE INDEX IF NOT EXISTS personal_tokens_user ON personal_tokens(user_id);
CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_grants_user ON oauth_grants(user_id);
CREATE INDEX IF NOT EXISTS oauth_grants_client ON oauth_grants(client_id);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  expires INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON oauth_tokens(grant_id);
`

type Row = Record<string, unknown>

/** What a valid bearer token names: the user, and the credential (a personal token or a grant) it belongs to. */
export interface Credential {
  userId: string
  /** "pat:<token id>" or "grant:<grant id>": revoking it ends the agent sessions opened with it. */
  credential: string
  kind: "pat" | "access"
  /** Milliseconds since the epoch; null for a personal token, which does not expire. */
  expires: number | null
}

export interface PersonalToken {
  id: string
  name: string
  created: number
  lastUsed: number | null
}

export interface OAuthClient {
  id: string
  name: string
  redirectUris: string[]
  created: number
}

export interface GrantView {
  id: string
  clientName: string
  created: number
  lastUsed: number
}

export const UNUSED_CLIENT_MS = 30 * 24 * 60 * 60_000
/** A full client table makes room only by dropping a never-used client at least this old. */
const EVICTABLE_AFTER_MS = 60 * 60_000

export class TokenStore {
  private readonly statements = new Map<string, StatementSync>()

  constructor(private readonly db: DatabaseSync) {
    db.exec(TOKEN_SCHEMA)
  }

  private sql(text: string): StatementSync {
    let statement = this.statements.get(text)
    if (!statement) {
      statement = this.db.prepare(text)
      this.statements.set(text, statement)
    }
    return statement
  }

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

  /** Adds a personal token unless the user has `max` already: count and insert in one transaction. */
  addPersonalToken(token: { id: string; hash: string; userId: string; name: string }, max: number, now: number): "added" | "full" {
    return this.transaction(() => {
      const count = Number((this.sql("SELECT COUNT(*) AS n FROM personal_tokens WHERE user_id = ?").get(token.userId) as Row).n)
      if (count >= max) return "full"
      this.sql("INSERT INTO personal_tokens (id, hash, user_id, name, created) VALUES (?, ?, ?, ?, ?)").run(token.id, token.hash, token.userId, token.name, now)
      return "added"
    })
  }

  /** The user's personal tokens, newest first: never their hash. */
  personalTokens(userId: string): PersonalToken[] {
    return (this.sql("SELECT id, name, created, last_used FROM personal_tokens WHERE user_id = ? ORDER BY created DESC, rowid DESC").all(userId) as Row[]).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      created: Number(row.created),
      lastUsed: row.last_used === null ? null : Number(row.last_used),
    }))
  }

  revokePersonalToken(userId: string, id: string): boolean {
    return Number(this.sql("DELETE FROM personal_tokens WHERE id = ? AND user_id = ?").run(id, userId).changes) === 1
  }

  touchPersonal(id: string, now: number): void {
    this.sql("UPDATE personal_tokens SET last_used = ? WHERE id = ?").run(now, id)
  }

  /** What a token hash names when it may open /mcp: a personal token, or a live access token. */
  credential(hash: string, now: number): Credential | undefined {
    const personal = this.sql("SELECT id, hash, user_id FROM personal_tokens WHERE hash = ?").get(hash) as Row | undefined
    if (personal && sameSecret(personal.hash as string, hash)) return { userId: personal.user_id as string, credential: `pat:${personal.id as string}`, kind: "pat", expires: null }
    const token = this.sql("SELECT * FROM oauth_tokens WHERE hash = ?").get(hash) as Row | undefined
    if (!token || !sameSecret(token.hash as string, hash) || token.kind !== "access" || Number(token.expires) <= now) return undefined
    return { userId: token.user_id as string, credential: `grant:${token.grant_id as string}`, kind: "access", expires: Number(token.expires) }
  }

  /** Whether a credential still exists (not revoked). */
  credentialLive(credential: string): boolean {
    const [kind, id] = credential.split(":") as [string, string]
    if (kind === "pat") return this.sql("SELECT 1 AS found FROM personal_tokens WHERE id = ?").get(id) !== undefined
    if (kind === "grant") return this.sql("SELECT 1 AS found FROM oauth_grants WHERE id = ?").get(id) !== undefined
    return false
  }

  /**
   * Registers a client. With `maxTotal` clients already, the oldest one that was never used for a grant and is over an
   * hour old makes room; when there is none, "full".
   */
  addClient(client: { id: string; name: string; redirectUris: string[] }, maxTotal: number, now: number): "added" | "full" {
    return this.transaction(() => {
      const total = Number((this.sql("SELECT COUNT(*) AS n FROM oauth_clients").get() as Row).n)
      if (total >= maxTotal) {
        const victim = this.sql(
          "SELECT id FROM oauth_clients c WHERE created <= ? AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = c.id) ORDER BY created, rowid LIMIT 1",
        ).get(now - EVICTABLE_AFTER_MS) as Row | undefined
        if (!victim) return "full"
        this.sql("DELETE FROM oauth_clients WHERE id = ?").run(victim.id as string)
      }
      this.sql("INSERT INTO oauth_clients (id, name, redirect_uris, created, last_used) VALUES (?, ?, ?, ?, ?)").run(client.id, client.name, JSON.stringify(client.redirectUris), now, now)
      return "added"
    })
  }

  client(id: string): OAuthClient | undefined {
    const row = this.sql("SELECT * FROM oauth_clients WHERE id = ?").get(id) as Row | undefined
    if (!row) return undefined
    return { id: row.id as string, name: row.name as string, redirectUris: JSON.parse(row.redirect_uris as string) as string[], created: Number(row.created) }
  }

  createGrant(grant: { id: string; userId: string; clientId: string }, now: number): void {
    this.sql("INSERT INTO oauth_grants (id, user_id, client_id, created, last_used) VALUES (?, ?, ?, ?, ?)").run(grant.id, grant.userId, grant.clientId, now, now)
    this.sql("UPDATE oauth_clients SET last_used = ? WHERE id = ?").run(now, grant.clientId)
  }

  issue(token: { hash: string; grantId: string; userId: string; kind: "access" | "refresh"; expires: number }): void {
    this.sql("INSERT INTO oauth_tokens (hash, grant_id, user_id, kind, expires) VALUES (?, ?, ?, ?, ?)").run(token.hash, token.grantId, token.userId, token.kind, token.expires)
  }

  /**
   * Trades a refresh token for new tokens of the same grant, in one transaction. A refresh token that was already
   * traded ("reused") revokes the whole grant; an unknown, expired or other client's token is "missing".
   */
  rotateRefresh(
    hash: string,
    clientId: string,
    next: readonly { hash: string; kind: "access" | "refresh"; expires: number }[],
    now: number,
  ): { result: "rotated" | "reused"; userId: string; grantId: string } | { result: "missing" } {
    return this.transaction(() => {
      const row = this.sql("SELECT t.*, g.client_id FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.hash = ?").get(hash) as Row | undefined
      if (!row || !sameSecret(row.hash as string, hash) || row.kind !== "refresh" || Number(row.expires) <= now || !sameSecret(row.client_id as string, clientId)) {
        return { result: "missing" as const }
      }
      const userId = row.user_id as string
      const grantId = row.grant_id as string
      if (Number(row.used) === 1) {
        this.sql("DELETE FROM oauth_grants WHERE id = ?").run(grantId)
        return { result: "reused" as const, userId, grantId }
      }
      this.sql("UPDATE oauth_tokens SET used = 1 WHERE hash = ?").run(hash)
      for (const token of next) this.issue({ ...token, grantId, userId })
      this.sql("UPDATE oauth_grants SET last_used = ? WHERE id = ?").run(now, grantId)
      return { result: "rotated" as const, userId, grantId }
    })
  }

  /**
   * Revokes one OAuth token for the client that holds it (RFC 7009): an access token alone, a refresh token with its
   * whole grant. The grant revoked, if any, so its sessions can be closed.
   */
  revokeToken(hash: string, clientId: string): { userId: string; grantId?: string } | undefined {
    return this.transaction(() => {
      const row = this.sql("SELECT t.*, g.client_id FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.hash = ?").get(hash) as Row | undefined
      if (!row || !sameSecret(row.hash as string, hash) || !sameSecret(row.client_id as string, clientId)) return undefined
      if (row.kind === "refresh") {
        this.sql("DELETE FROM oauth_grants WHERE id = ?").run(row.grant_id as string)
        return { userId: row.user_id as string, grantId: row.grant_id as string }
      }
      this.sql("DELETE FROM oauth_tokens WHERE hash = ?").run(hash)
      return { userId: row.user_id as string }
    })
  }

  /** The person's connected clients: one row per grant. */
  grants(userId: string): GrantView[] {
    return (this.sql("SELECT g.id, g.created, g.last_used, c.name FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id WHERE g.user_id = ? ORDER BY g.created DESC, g.rowid DESC").all(userId) as Row[]).map((row) => ({
      id: row.id as string,
      clientName: row.name as string,
      created: Number(row.created),
      lastUsed: Number(row.last_used),
    }))
  }

  revokeGrant(userId: string, grantId: string): boolean {
    return Number(this.sql("DELETE FROM oauth_grants WHERE id = ? AND user_id = ?").run(grantId, userId).changes) === 1
  }

  /** Every grant and OAuth token of the user, and every personal token. */
  revokeUser(userId: string): void {
    this.transaction(() => {
      this.sql("DELETE FROM oauth_grants WHERE user_id = ?").run(userId)
      this.sql("DELETE FROM oauth_tokens WHERE user_id = ?").run(userId)
      this.sql("DELETE FROM personal_tokens WHERE user_id = ?").run(userId)
    })
  }

  /** Drops expired OAuth tokens and clients unused for 30 days (no grant, and none made for 30 days). */
  sweep(now: number): void {
    this.sql("DELETE FROM oauth_tokens WHERE expires <= ?").run(now)
    this.sql("DELETE FROM oauth_clients WHERE last_used <= ? AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = oauth_clients.id)").run(now - UNUSED_CLIENT_MS)
  }
}
