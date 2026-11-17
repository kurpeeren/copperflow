import { spawnSync } from "node:child_process"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * A new temp folder, named by its 8.3 short path on Windows when the disk keeps short names (as the CI runner's temp
 * folder is), so a test sees the same paths the program meets there. Elsewhere the folder as made.
 */
export async function shortTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}long-folder-name-`))
  if (process.platform !== "win32") return dir
  const run = spawnSync("cmd", ["/d", "/s", "/c", `"for %I in ("${dir}") do @echo %~sI"`], { encoding: "utf8", windowsVerbatimArguments: true })
  const short = run.status === 0 ? run.stdout.trim() : ""
  return short === "" ? dir : short
}
