// The data directory, the database and the key file are the owner's alone. They are created owner-only, and an
// existing one that group or others may read is refused with a message. On Windows, POSIX modes say nothing about who
// may read a file (access lists do), so nothing is checked there: the maintainer keeps the data directory in a folder
// only the hub's account can open.
import { mkdir, open, stat } from "node:fs/promises"
import { join } from "node:path"

/** Whether a POSIX mode lets group or others in. */
export function looserThanOwner(mode: number): boolean {
  return (mode & 0o077) !== 0
}

async function checkOwnerOnly(path: string, what: string, platform: NodeJS.Platform): Promise<void> {
  if (platform === "win32") return
  if (looserThanOwner((await stat(path)).mode)) {
    throw new Error(`${what} (${path}) must be readable by its owner only: run chmod ${what === "The data directory" ? "700" : "600"} on it`)
  }
}

/** Makes (or checks) the data directory and the database file owner-only; returns the database's path. */
export async function prepareDataDir(dataDir: string, platform = process.platform): Promise<string> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  await checkOwnerOnly(dataDir, "The data directory", platform)
  const db = join(dataDir, "hub.db")
  // Created with mode 600 before SQLite opens it; SQLite gives its -wal and -shm files the same mode.
  await (await open(db, "a", 0o600)).close()
  await checkOwnerOnly(db, "hub.db", platform)
  return db
}
