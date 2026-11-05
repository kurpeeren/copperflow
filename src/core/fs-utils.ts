import { randomBytes } from "node:crypto"
import { rename, rm, writeFile } from "node:fs/promises"

/** The file operations writeFileAtomic uses; tests replace them. */
export interface AtomicWriteOps {
  rename(from: string, to: string): Promise<void>
  wait(ms: number): Promise<void>
}

const DEFAULT_OPS: AtomicWriteOps = { rename, wait: (ms) => new Promise((done) => setTimeout(done, ms)) }
/** Windows refuses a rename with these while another process (an editor, a virus scanner, the watcher) holds the file. */
const TRANSIENT_RENAME_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"])
const RENAME_RETRIES = 10
const FIRST_WAIT_MS = 10
const MAX_WAIT_MS = 100

/**
 * Writes through a temporary file and a rename, so readers never see a half-written file. A rename
 * that fails because the file is briefly held is retried; when it still fails, the temporary file
 * is removed and the last error thrown.
 */
export async function writeFileAtomic(path: string, text: string, ops: AtomicWriteOps = DEFAULT_OPS): Promise<void> {
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  await writeFile(temp, text)
  try {
    await renameWithRetry(temp, path, ops)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

/** Waits 10, 20, 40, 80, then 100 ms between tries: under a second over all ten retries. */
async function renameWithRetry(from: string, to: string, ops: AtomicWriteOps): Promise<void> {
  for (let retry = 0; ; retry++) {
    try {
      return await ops.rename(from, to)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ""
      if (retry >= RENAME_RETRIES || !TRANSIENT_RENAME_ERRORS.has(code)) throw error
      await ops.wait(Math.min(FIRST_WAIT_MS * 2 ** retry, MAX_WAIT_MS))
    }
  }
}

/** Runs tasks with the same key one after another, in call order. */
export function serialized<T>(queues: Map<string, Promise<void>>, key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const run = previous.then(task)
  const settled = run.then(
    () => undefined,
    () => undefined,
  )
  queues.set(key, settled)
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key)
  })
  return run
}
