import { randomBytes } from "node:crypto"
import { rename, rm, writeFile } from "node:fs/promises"

/** Writes through a temporary file and a rename, so readers never see a half-written file. */
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  await writeFile(temp, text)
  try {
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
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
