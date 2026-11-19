// The desktop app's main process. One exe does two jobs:
// - started with a copperflow command (`copperflow.exe mcp`, `copperflow.exe studio`, ...) it runs that command as
//   plain Node, with no window, so an agent client can start the MCP server from it;
// - started with nothing, a folder or a .circuit.tsx file, it opens a window: the start screen, then the Studio.
// An agent client that is connected through "Connect to Claude" starts the exe with ELECTRON_RUN_AS_NODE=1 and never
// reaches this file at all: the exe is then Node itself.
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { app } from "electron"
import { appMode } from "../../dist/desktop/index.js"
import { CLI } from "./paths.js"
import { startWindowApp } from "./window-app.js"

// `electron <app folder> ...` while developing puts the app folder before the arguments; the installed exe does not.
const mode = appMode(process.argv.slice(process.defaultApp ? 2 : 1))
if (mode.kind === "cli") runCommand(mode.args)
else startWindowApp(mode.open)

/** Runs the copperflow command line in a child that is plain Node, on this process's own standard input and output. */
function runCommand(args: string[]): void {
  // This process only waits for the child. Its own browser engine still starts, so it is kept off the GPU and out of
  // the window's profile folder, which an open window holds (a shared profile makes Chromium print cache errors).
  app.disableHardwareAcceleration()
  app.setPath("userData", join(tmpdir(), "copperflow-command"))
  // The child gets the same stdin, stdout and stderr: an MCP client's pipes reach the MCP server unchanged.
  const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "inherit", windowsHide: true })
  child.on("exit", (code) => app.exit(code ?? 1))
  child.on("error", (error) => {
    process.stderr.write(`copperflow could not start its command line: ${error.message}\n`)
    app.exit(1)
  })
}
