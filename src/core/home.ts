// The person's own copperflow folder, outside every project: the Studio's notes, the record of libraries and the
// marks a person leaves on library modules live here.
import { homedir } from "node:os"
import { join } from "node:path"

/** The person's copperflow folder: COPPERFLOW_HOME, else .copperflow in the home folder. */
export function copperflowHome(env: NodeJS.ProcessEnv = process.env): string {
  const chosen = env["COPPERFLOW_HOME"]
  return chosen !== undefined && chosen !== "" ? chosen : join(homedir(), ".copperflow")
}
