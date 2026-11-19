import { randomBytes } from "node:crypto"
import { chmod, mkdir, readlink, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

/** What writeFileAtomic does to the disk and the clock; tests replace parts of it. */
export interface AtomicWriteIo {
  rename(from: string, to: string): Promise<void>
  wait(ms: number): Promise<void>
  platform: NodeJS.Platform
}

const DEFAULT_IO: AtomicWriteIo = { rename, wait: (ms) => new Promise((done) => setTimeout(done, ms)), platform: process.platform }
/** Windows refuses a rename with these while another program (an editor, a virus scanner, the app itself) holds the file. */
const HELD_FILE_ERRORS = new Set(["EPERM", "EBUSY", "EACCES"])
const RENAME_TRIES = 6
const RENAME_RETRY_DELAY_MS = 100
const RANDOM_BYTES = 6
const MODE_BITS = 0o7777

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code

/** Where a write of `file` goes: through a symbolic link to its target, so the link stays a link. */
async function realTarget(file: string): Promise<string> {
  try {
    return await realpath(file)
  } catch (error) {
    if (codeOf(error) !== "ENOENT") throw error
  }
  // Nothing there, or a link whose target is not there yet: then the write makes the target.
  try {
    return resolve(dirname(file), await readlink(file))
  } catch (error) {
    if (codeOf(error) === "ENOENT" || codeOf(error) === "EINVAL") return file
    throw error
  }
}

/** The permission bits of the file being replaced, or undefined when there is none yet. */
async function existingMode(file: string): Promise<number | undefined> {
  try {
    return (await stat(file)).mode & MODE_BITS
  } catch (error) {
    if (codeOf(error) === "ENOENT") return undefined
    throw error
  }
}

async function renameRetrying(from: string, to: string, io: AtomicWriteIo): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await io.rename(from, to)
    } catch (error) {
      if (io.platform !== "win32" || !HELD_FILE_ERRORS.has(codeOf(error) ?? "")) throw error
      if (attempt >= RENAME_TRIES) {
        throw new Error(`${to} could not be replaced: another program may hold it open, or it is read-only. Close that program and try again.`, { cause: error })
      }
      await io.wait(RENAME_RETRY_DELAY_MS)
    }
  }
}

async function removeTemp(temp: string): Promise<void> {
  try {
    await rm(temp, { force: true })
  } catch (error) {
    // The write already failed and that error is what the caller hears; a temporary file left behind is only named here.
    process.stderr.write(`copperflow: the temporary file ${temp} could not be removed: ${(error as Error).message}\n`)
  }
}

/**
 * Writes beside the target and renames, so a crash never leaves half a file. Each call has its own temporary file; the
 * replaced file's mode is kept; a symbolic link is written through; the temporary file is removed when anything fails.
 */
export async function writeFileAtomic(file: string, text: string, given: Partial<AtomicWriteIo> = {}): Promise<void> {
  const io = { ...DEFAULT_IO, ...given }
  const target = await realTarget(file)
  await mkdir(dirname(target), { recursive: true })
  const mode = await existingMode(target)
  const temp = `${target}.${process.pid}.${randomBytes(RANDOM_BYTES).toString("hex")}.tmp`
  try {
    await writeFile(temp, text, { flag: "wx" })
    if (mode !== undefined) await chmod(temp, mode)
    await renameRetrying(temp, target, io)
  } catch (error) {
    await removeTemp(temp)
    throw error
  }
}
