// The window: the start screen, then the Studio of one project folder, served in this process on a free local port.
// The Studio leaves its note (with host "desktop") as `copperflow studio` does, so an agent's open_studio finds this
// window, brings it to the front, and the agent's changes appear in it as they are written.
import { stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { app, BrowserWindow, dialog, session, shell } from "electron"
import { appMode, recentProjects } from "../../dist/desktop/index.js"
import { runStudio, type RunningStudio } from "../../dist/studio/run-studio.js"
import { registerIpc } from "./ipc.js"
import { ICON, PRELOAD, START_PAGE } from "./paths.js"

const WINDOW = { width: 1440, height: 900, minWidth: 900, minHeight: 600 }
/** The one permission the Studio asks for: copying a package string (Library → Packages, navigator.clipboard). */
const STUDIO_PERMISSIONS = new Set(["clipboard-sanitized-write"])
/** The window's colour before the first page paints, the Studio's ground colour, so opening does not flash white. */
const GROUND = "#F5F6F8"
const CIRCUIT_SUFFIX = ".circuit.tsx"

let window: BrowserWindow | undefined
let running: RunningStudio | undefined
const recent = () => recentProjects(join(app.getPath("userData"), "recent-projects.json"))

export function startWindowApp(open: string | undefined): void {
  if (!app.requestSingleInstanceLock()) {
    // Another window is already open: it receives this start's arguments (second-instance) and opens the project.
    app.quit()
    return
  }
  app.on("second-instance", (_event, argv) => {
    showWindow()
    const mode = appMode(argv.slice(process.defaultApp ? 2 : 1))
    if (mode.kind === "window" && mode.open !== undefined) void openProject(mode.open)
  })
  app.on("window-all-closed", () => void quit())
  app.whenReady().then(() => {
    registerIpc({ recent, openProject, backToProjects, isStartPage, isStudio })
    limitPermissions()
    window = createWindow()
    if (open !== undefined) void openProject(open)
    else void window.loadFile(START_PAGE)
  }, fail)
}

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    ...WINDOW,
    title: "copperflow",
    icon: ICON,
    backgroundColor: GROUND,
    autoHideMenuBar: true,
    // backgroundThrottling off: the agent works while this window sits behind its chat, and the board, the build state
    // and the agent strip should be current the moment the person looks.
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, backgroundThrottling: false },
  })
  // The Studio draws its own menu bar; a native one would take its keys (Ctrl+Z, Ctrl+C, ...) before the page.
  created.removeMenu()
  guardNavigation(created)
  return created
}

/** Electron grants every permission a page asks for unless told otherwise; here only the Studio's clipboard write. */
function limitPermissions(): void {
  const grant = (url: string, permission: string) => STUDIO_PERMISSIONS.has(permission) && isStudio(url)
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(grant(contents.getURL(), permission)))
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => grant(origin, permission))
}

/** The start screen itself, whatever its fragment or query. */
function isStartPage(url: string): boolean {
  const start = new URL(startPageUrl())
  const page = parsed(url)
  return page !== undefined && page.protocol === "file:" && page.pathname === start.pathname
}

/** A page of the Studio this window runs now: its origin exactly, not a prefix of it. */
function isStudio(url: string): boolean {
  const page = parsed(url)
  return running !== undefined && page !== undefined && page.origin === new URL(running.studio.url).origin
}

function parsed(url: string): URL | undefined {
  try {
    return new URL(url)
  } catch {
    // Not an address at all: nothing the window may open.
    return undefined
  }
}

/** Pages open only the start screen and the running Studio; other web addresses go to the person's browser. */
function guardNavigation(target: BrowserWindow): void {
  const allowed = (url: string) => isStartPage(url) || isStudio(url)
  const outside = (url: string) => {
    if (/^https?:\/\//i.test(url) && !allowed(url)) void shell.openExternal(url)
  }
  target.webContents.setWindowOpenHandler(({ url }) => {
    outside(url)
    return { action: "deny" }
  })
  // The main frame (navigations and redirects) only to the two pages; a frame inside a page only to the Studio.
  const keepTo = (check: (url: string) => boolean) => (event: { preventDefault(): void }, url: string) => {
    if (check(url)) return
    event.preventDefault()
    outside(url)
  }
  target.webContents.on("will-navigate", keepTo(allowed))
  target.webContents.on("will-redirect", keepTo(allowed))
  target.webContents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame && !isStudio(event.url)) event.preventDefault()
  })
  target.webContents.on("before-input-event", (_event, input) => {
    if (!app.isPackaged && input.type === "keyDown" && input.key === "F12") target.webContents.toggleDevTools()
  })
}

function startPageUrl(): string {
  return pathToFileURL(START_PAGE).href
}

/** Opens a project folder (or the folder of a circuit file) in the window, closing the one open before. */
async function openProject(target: string): Promise<void> {
  const full = resolve(target)
  const root = full.toLowerCase().endsWith(CIRCUIT_SUFFIX) ? dirname(full) : full
  const shown = showWindow()
  try {
    if (!(await isFolder(root))) throw new Error("There is no folder here: it was moved, renamed or deleted.")
    await stopStudio()
    running = await runStudio({ root, host: "desktop", onFocus: () => void showWindow() })
    await recent().add(root)
    shown.setTitle(`copperflow: ${root}`)
    await shown.loadURL(running.studio.openUrl)
  } catch (error) {
    dialog.showErrorBox("copperflow could not open the project", `${root}\n\n${(error as Error).message}`)
    await backToProjects()
  }
}

async function backToProjects(): Promise<void> {
  await stopStudio()
  const shown = showWindow()
  shown.setTitle("copperflow")
  await shown.loadFile(START_PAGE)
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    // Missing or unreadable: either way there is no folder to open, and the caller says so.
    return false
  }
}

function showWindow(): BrowserWindow {
  if (window === undefined || window.isDestroyed()) window = createWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return window
}

async function stopStudio(): Promise<void> {
  const current = running
  running = undefined
  await current?.stop()
}

async function quit(): Promise<void> {
  try {
    await stopStudio()
  } finally {
    app.quit()
  }
}

function fail(error: unknown): void {
  dialog.showErrorBox("copperflow could not start", (error as Error).message)
  app.exit(1)
}
