// Where the app's parts are. The compiled main process sits in <app>/desktop/build/, beside the program it hosts:
// <app>/dist (the CLI, the Studio server and the browser app), <app>/library and <app>/node_modules. The same layout
// holds while developing (the repository is <app>) and in the installed app (resources/app is <app>).
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const build = dirname(fileURLToPath(import.meta.url))

/** The folder that holds dist/, library/ and node_modules/. */
export const APP_DIR = join(build, "..", "..")
/** The copperflow command line, run as plain Node for `copperflow.exe mcp` and the other commands. */
export const CLI = join(APP_DIR, "dist", "cli.js")
/** The start screen: recent projects, open a folder, a new project, connecting the Claude apps. */
export const START_PAGE = join(build, "..", "start", "index.html")
/** The only script the pages get from the app: a few calls to the main process, through contextBridge. */
export const PRELOAD = join(build, "..", "preload.cjs")
/** The window and taskbar icon: .ico on Windows, the large PNG elsewhere (macOS takes the app bundle's own). */
export const ICON = join(build, "..", "build-resources", process.platform === "win32" ? "icon.ico" : "icon.png")
