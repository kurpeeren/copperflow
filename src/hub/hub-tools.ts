// The tools the hub answers itself (list_projects, new_project, open_project, guide), the tool-call limit, and the
// dispatch to the open project's workspace for every other tool. The open project is state of the agent's session.
import { readdir } from "node:fs/promises"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { guideInSession, guideInput, type GuideMemory } from "../mcp/guide.js"
import { auditRoutine, type Hub } from "./context.js"
import { forwardTool, type Upstream } from "./mcp-forward.js"
import { addProject, projectName } from "./project-routes.js"
import { ID_PATTERN } from "./secrets.js"
import { projectNameKey, type Project } from "./store.js"

export const TOOL_CALLS_PER_MINUTE = 60

/** One agent session at the hub. */
export interface AgentState {
  userId: string
  credential: string
  projectId?: string | undefined
  upstream?: Upstream | undefined
  /** The connect in flight, shared by concurrent calls (mcp-forward.ts). */
  connecting?: { key: string; promise: Promise<Upstream> } | undefined
  /** The guide texts this session has been given (at most 32 argument sets); never shared with another session. */
  guideSeen: GuideMemory
  closed: boolean
}

/** The request's credential, as the bearer check found it (the hash only, never the token). */
export interface CallAuth {
  hash: string
  userId: string
  credential: string
}

export function text(message: string, isError = false): CallToolResult {
  return { ...(isError ? { isError: true } : {}), content: [{ type: "text", text: message }] }
}

/** Whether the session and the token of this request still hold: asked after every wait, before acting. */
export function stillAuthorised(hub: Hub, state: AgentState, auth: CallAuth): boolean {
  if (state.closed) return false
  const found = hub.store.tokens.credential(auth.hash, hub.config.now())
  if (!found || found.userId !== state.userId || found.credential !== state.credential) return false
  const user = hub.store.userById(state.userId)
  return user !== undefined && !user.mustChangePassword
}

const NO_PROJECT = "No project is open. Call list_projects, then open_project { name } or new_project { name }, and call this tool again."
const NOT_FOUND = "There is no such project. Call list_projects to see yours."

/** Counts the call before anything waits; the refusal the agent reads, if over the limit. */
function limited(hub: Hub, userId: string, address: string): CallToolResult | undefined {
  const now = hub.config.now()
  const check = hub.limits.toolCalls.check(userId, now)
  if (!check.ok) {
    auditRoutine(hub, address, userId, "tool-calls-limited")
    return text(`429 Too many tool calls: at most ${TOOL_CALLS_PER_MINUTE} a minute. Wait ${check.retryAfterS} s, then call again.`, true)
  }
  // Keyed by user id (only signed-in users reach this), so the table holds at most one key per account.
  if (hub.limits.toolCalls.add(userId, now) === "full") {
    hub.log("the tool-call limiter table is full")
    return text("The service is busy. Wait a minute, then call again.", true)
  }
  return undefined
}

export async function callTool(hub: Hub, state: AgentState, auth: CallAuth, name: string, args: Record<string, unknown>, address: string, signal: AbortSignal): Promise<CallToolResult> {
  const refused = limited(hub, state.userId, address)
  if (refused) return refused
  if (!stillAuthorised(hub, state, auth)) return text("Access was revoked. Connect again.", true)
  switch (name) {
    case "list_projects":
      return listProjects(hub, state)
    case "new_project":
      return newProject(hub, state, auth, args, address)
    case "open_project":
      return openProject(hub, state, args)
    case "guide":
      return guideTool(state, args)
  }
  if (!hub.catalog.forwarded.has(name)) return text(`Unknown tool: ${name}`, true)
  const project = state.projectId === undefined ? undefined : hub.store.project(state.userId, state.projectId)
  if (!project) return text(NO_PROJECT, true)
  return forwardTool(hub, state, auth, project.id, name, args, signal)
}

function watchAt(hub: Hub, project: Project): string {
  return `The person watches it at ${hub.config.publicOrigin}/p/${project.id}/`
}

function open(hub: Hub, state: AgentState, project: Project): void {
  if (state.projectId !== project.id) {
    state.upstream?.close()
    state.upstream = undefined
    // A connect still in flight for the old project closes itself when it finishes.
    state.connecting = undefined
  }
  state.projectId = project.id
}

/**
 * Circuit files in the project folder: one listing of names in the folder itself, which the hub made and a workspace
 * cannot replace. Nothing below it is read (rule 8 of docs/hosted.md): a `parts` directory the workspace made may be a
 * planted link, so the number of parts is not counted here; the workspace's own project_status reports it.
 */
async function counts(hub: Hub, project: Project): Promise<string> {
  const dir = hub.files.projectDir(project.userId, project.id)
  try {
    const circuits = (await readdir(dir)).filter((file) => file.endsWith(".circuit.tsx")).length
    return `, ${circuits} circuit${circuits === 1 ? "" : "s"}`
  } catch {
    return ""
  }
}

async function listProjects(hub: Hub, state: AgentState): Promise<CallToolResult> {
  const projects = hub.store.projects(state.userId)
  if (projects.length === 0) return text("You have no projects yet. Call new_project { name } to make one.")
  const lines = await Promise.all(projects.map(async (p) => `- ${p.name} (id ${p.id}${await counts(hub, p)})${p.id === state.projectId ? " [open]" : ""}`))
  return text(`Your projects (${projects.length} of ${hub.config.maxProjects}):\n${lines.join("\n")}`)
}

const newProjectInput = z.object({ name: z.string().max(1000) })
const openProjectInput = z.object({ name: z.string().max(1000).optional(), id: z.string().max(100).optional() })

async function newProject(hub: Hub, state: AgentState, auth: CallAuth, args: Record<string, unknown>, address: string): Promise<CallToolResult> {
  const parsed = newProjectInput.safeParse(args)
  const name = parsed.success ? projectName(parsed.data.name) : undefined
  if (!name) return text("A project name has 1 to 100 characters.", true)
  const made = await addProject(hub, state.userId, name, address, () => stillAuthorised(hub, state, auth))
  if ("problem" in made) return text(made.problem.text, true)
  if (!stillAuthorised(hub, state, auth)) return text("Access was revoked. Connect again.", true)
  open(hub, state, made.project)
  return text(`Project "${made.project.name}" created and open (id ${made.project.id}). ${watchAt(hub, made.project)}`)
}

function openProject(hub: Hub, state: AgentState, args: Record<string, unknown>): CallToolResult {
  const parsed = openProjectInput.safeParse(args)
  if (!parsed.success || (parsed.data.name === undefined) === (parsed.data.id === undefined)) return text("Give the project's name or its id.", true)
  const { id, name } = parsed.data
  let project: Project | undefined
  if (id !== undefined) project = ID_PATTERN.test(id) ? hub.store.project(state.userId, id) : undefined
  else {
    const wanted = projectName(name)
    const matches = wanted === undefined ? [] : hub.store.projects(state.userId).filter((p) => projectNameKey(p.name) === projectNameKey(wanted))
    // Names made before they were unique regardless of case can match more than one: the agent must pick by id.
    if (matches.length > 1) return text(`Several projects have that name: ${matches.map((p) => `"${p.name}" (id ${p.id})`).join(", ")}. Open one by its id.`, true)
    project = matches[0]
  }
  if (!project) return text(NOT_FOUND, true)
  open(hub, state, project)
  return text(`Project "${project.name}" is open (id ${project.id}). ${watchAt(hub, project)}`)
}

async function guideTool(state: AgentState, args: Record<string, unknown>): Promise<CallToolResult> {
  const parsed = z.object(guideInput).safeParse(args)
  if (!parsed.success) return text("guide takes { topic?, again? } with a topic name and true or false.", true)
  try {
    return text(await guideInSession(state.guideSeen, parsed.data))
  } catch (error) {
    return text((error as Error).message, true)
  }
}
