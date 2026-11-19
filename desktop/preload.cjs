// The pages' only way to the main process: a few named calls, each checked there against the page that made it.
// A sandboxed preload must be CommonJS, hence .cjs.
const { contextBridge, ipcRenderer } = require("electron")

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld("copperflowDesktop", {
  info: call("app:info"),
  listProjects: call("projects:list"),
  removeProject: call("projects:remove"),
  openProject: call("projects:open"),
  openFolder: call("projects:open-folder"),
  newProject: call("projects:new"),
  connectClaudeDesktop: call("claude:connect-desktop"),
  copyClaudeCodeCommand: call("claude:copy-code-command"),
  backToProjects: call("studio:projects"),
  showInFolder: call("studio:show-in-folder"),
})
