// The start screen. Every action goes through window.copperflowDesktop (desktop/preload.cjs) to the main process.
"use strict"

const desktop = window.copperflowDesktop
const $ = (id) => document.getElementById(id)
const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

/** Runs an action, showing its error under the buttons instead of losing it. */
async function attempt(action) {
  $("problem").hidden = true
  try {
    return await action()
  } catch (error) {
    $("problem").textContent = messageOf(error)
    $("problem").hidden = false
    return undefined
  }
}

/** Electron prefixes a main-process error with "Error invoking remote method '...': Error: "; the person needs the rest. */
function messageOf(error) {
  const text = String(error && error.message ? error.message : error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
}

function projectItem(project) {
  const item = document.createElement("li")
  const open = document.createElement("button")
  open.type = "button"
  open.className = project.missing ? "project missing" : "project"
  open.disabled = project.missing
  const name = document.createElement("span")
  name.className = "name"
  name.textContent = project.name
  const path = document.createElement("span")
  path.className = "path"
  path.textContent = project.root
  path.title = project.root
  const meta = document.createElement("span")
  meta.className = "meta"
  const circuits = project.circuits.length > 0 ? project.circuits.join(", ") : "no circuit yet"
  meta.textContent = `Opened ${DATE.format(new Date(project.opened))}: ${circuits}`
  open.append(name, path, meta)
  open.addEventListener("click", () => attempt(() => desktop.openProject(project.root)))
  const forget = document.createElement("button")
  forget.type = "button"
  forget.className = "forget"
  forget.textContent = "Remove"
  forget.title = "Remove from this list; the folder stays as it is"
  forget.addEventListener("click", async () => {
    const left = await attempt(() => desktop.removeProject(project.root))
    if (left) showProjects(left)
  })
  item.append(open, forget)
  return item
}

function showProjects(projects) {
  $("recent-list").replaceChildren(...projects.map(projectItem))
  $("recent-empty").hidden = projects.length > 0
}

function showNote(text, kind) {
  const note = $("agent-note")
  note.textContent = text
  note.className = `note ${kind}`
  note.hidden = false
}

$("open-folder").addEventListener("click", () => attempt(() => desktop.openFolder()))

$("new-project").addEventListener("submit", (event) => {
  event.preventDefault()
  const name = $("project-name").value.trim()
  if (name === "") {
    $("project-name").focus()
    return
  }
  void attempt(() => desktop.newProject(name))
})

$("connect-desktop").addEventListener("click", async () => {
  try {
    const result = await desktop.connectClaudeDesktop()
    showNote(result.message, "done")
  } catch (error) {
    showNote(messageOf(error), "failed")
  }
})

$("copy-code").addEventListener("click", async () => {
  try {
    const command = await desktop.copyClaudeCodeCommand()
    showNote(`Copied: ${command}`, "done")
  } catch (error) {
    showNote(messageOf(error), "failed")
  }
})

attempt(async () => {
  const info = await desktop.info()
  $("version").textContent = `Version ${info.version}`
  showProjects(await desktop.listProjects())
})
