// The calls the pages may make to the main process. The start screen may make all of them; the Studio page only the
// one that goes back to the start screen. A call from any other page is refused.
import { app, clipboard, dialog, ipcMain, type IpcMainInvokeEvent } from "electron"
import { claudeCodeCommand, claudeDesktopConfigFile, connectClaudeDesktop, createProject, mcpLaunch, type RecentProjects } from "../../dist/desktop/index.js"
import { VERSION } from "../../dist/version.js"
import { APP_DIR } from "./paths.js"

export interface IpcHost {
  recent: () => RecentProjects
  openProject: (root: string) => Promise<void>
  backToProjects: () => Promise<void>
  /** Whether an address is the start screen, and whether it is a page of the Studio that is open now. */
  isStartPage: (url: string) => boolean
  isStudio: (url: string) => boolean
}

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

export function registerIpc(host: IpcHost): void {
  const fromStart = (handler: Handler): Handler => (event, ...args) => {
    if (!host.isStartPage(event.senderFrame?.url ?? "")) throw new Error("This call is for the start screen only")
    return handler(event, ...args)
  }
  const fromStudio = (handler: Handler): Handler => (event, ...args) => {
    if (!host.isStudio(event.senderFrame?.url ?? "")) throw new Error("This call is for the Studio only")
    return handler(event, ...args)
  }
  ipcMain.handle("app:info", fromStart(() => ({ version: VERSION, documents: app.getPath("documents") })))
  ipcMain.handle("projects:list", fromStart(() => host.recent().list()))
  ipcMain.handle("projects:remove", fromStart((_event, root) => host.recent().remove(text(root, "root"))))
  ipcMain.handle("projects:open", fromStart((_event, root) => host.openProject(text(root, "root"))))
  ipcMain.handle("projects:open-folder", fromStart(() => chooseFolder(host)))
  ipcMain.handle("projects:new", fromStart((_event, name) => newProject(host, text(name, "name"))))
  ipcMain.handle("claude:connect-desktop", fromStart(() => connectClaudeDesktop(claudeDesktopConfigFile(), launch())))
  ipcMain.handle("claude:copy-code-command", fromStart(() => copyCodeCommand()))
  ipcMain.handle("studio:projects", fromStudio(() => host.backToProjects()))
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`A ${what} is needed`)
  return value
}

/** How an agent client starts the MCP server from this installed app: the exe as plain Node, no window. */
function launch() {
  return mcpLaunch(process.execPath, APP_DIR)
}

function copyCodeCommand(): string {
  const command = claudeCodeCommand(launch())
  clipboard.writeText(command)
  return command
}

async function chooseFolder(host: IpcHost): Promise<boolean> {
  const chosen = await dialog.showOpenDialog({ title: "Open a project folder", properties: ["openDirectory"] })
  const root = chosen.filePaths[0]
  if (chosen.canceled || root === undefined) return false
  await host.openProject(root)
  return true
}

/** Asks where the new project's folder goes, makes it with a starter circuit, and opens it. */
async function newProject(host: IpcHost, name: string): Promise<boolean> {
  const chosen = await dialog.showOpenDialog({
    title: `Where should the folder "${name}" go?`,
    defaultPath: app.getPath("documents"),
    buttonLabel: "Make the project here",
    properties: ["openDirectory", "createDirectory"],
  })
  const parent = chosen.filePaths[0]
  if (chosen.canceled || parent === undefined) return false
  const made = await createProject(parent, name)
  await host.openProject(made.root)
  return true
}
