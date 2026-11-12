// A small browser stand-in for hub tests: one cookie jar, forms with the page's hidden token, and the public Origin.
import { request } from "node:http"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startHub, type HubOptions, type HubServer } from "../../src/hub/server.js"
import type { Launched, WorkspaceRunner } from "../../src/hub/runner/runner.js"
import { ManagedRunner } from "../../src/hub/runner/runner.js"
import { hashSecret } from "../../src/hub/secrets.js"

export const ORIGIN = "https://cf.example.test"

export interface Answer {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: Buffer
  text: string
}

export function send(base: string, method: string, path: string, headers: Record<string, string> = {}, body?: Buffer | string): Promise<Answer> {
  const url = new URL(base)
  return new Promise((done, fail) => {
    const req = request({ agent: false, host: url.hostname, port: url.port, method, path, headers: { ...(body !== undefined ? { "content-length": String(Buffer.byteLength(body)) } : {}), ...headers } }, (res) => {
      const chunks: Buffer[] = []
      res.on("error", fail)
      res.on("data", (chunk: Buffer) => chunks.push(chunk))
      res.on("end", () => {
        const all = Buffer.concat(chunks)
        done({ status: res.statusCode ?? 0, headers: res.headers, body: all, text: all.toString("utf8") })
      })
    })
    req.on("error", fail)
    req.end(body)
  })
}

/** The value of the hidden form token on a page. */
export function formToken(html: string): string {
  const match = /name="form" value="([^"]+)"/.exec(html)
  if (!match) throw new Error("no form token on the page")
  return match[1] as string
}

export class Browser {
  readonly jar = new Map<string, string>()

  /** The Host every request names: the public origin's, as a browser on that site would send. */
  readonly host: string

  constructor(
    readonly base: string,
    readonly origin = ORIGIN,
  ) {
    this.host = new URL(origin || ORIGIN).host
  }

  /** Follows /p/<id>/ to the project's own origin and its /_enter, keeping the workspace cookie; returns the answers. */
  async openProject(id: string): Promise<{ handover: Answer; entered?: Answer }> {
    const handover = await this.get(`/p/${id}/`)
    const location = String(handover.headers.location ?? "")
    if (handover.status !== 303 || !location.includes("/_enter?")) return { handover }
    const url = new URL(location)
    return { handover, entered: await this.onProject(id, "GET", `${url.pathname}${url.search}`) }
  }

  /** A request on project `id`'s own origin (its Host and Origin), with this browser's cookies. */
  async onProject(id: string, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Answer> {
    const origin = projectOriginOf(id)
    const extra: Record<string, string> = method === "GET" || method === "HEAD" ? {} : { origin }
    return this.keep(await send(this.base, method, path, { host: new URL(origin).host, ...extra, ...this.cookieHeader(), ...headers }, body))
  }

  /** The Cookie header this browser would send. */
  cookie(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ")
  }

  private cookieHeader(): Record<string, string> {
    return this.jar.size ? { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}
  }

  private keep(answer: Answer): Answer {
    const set = answer.headers["set-cookie"] ?? []
    for (const line of Array.isArray(set) ? set : [set]) {
      const [pair] = line.split(";")
      const at = (pair as string).indexOf("=")
      const name = (pair as string).slice(0, at)
      const value = (pair as string).slice(at + 1)
      if (/Max-Age=0/.test(line)) this.jar.delete(name)
      else this.jar.set(name, value)
    }
    return answer
  }

  async get(path: string, headers: Record<string, string> = {}): Promise<Answer> {
    return this.keep(await send(this.base, "GET", path, { host: this.host, ...this.cookieHeader(), ...headers }))
  }

  async post(path: string, fields: Record<string, string>, headers: Record<string, string> = {}): Promise<Answer> {
    const body = new URLSearchParams(fields).toString()
    return this.keep(await send(this.base, "POST", path, { host: this.host, "content-type": "application/x-www-form-urlencoded", ...(this.origin ? { origin: this.origin } : {}), ...this.cookieHeader(), ...headers }, body))
  }

  /** Opens `page` and posts its form with the hidden token. */
  async submit(page: string, action: string, fields: Record<string, string>, headers: Record<string, string> = {}): Promise<Answer> {
    const shown = await this.get(page)
    // Signed in, the sign-in page redirects: the form cookie still holds the anonymous token.
    const fromCookie = this.jar.get("__Host-copperflow-form") ?? this.jar.get("copperflow-form")
    const token = shown.status === 303 && page === "/signin" && fromCookie ? fromCookie : formToken(shown.text)
    return this.post(action, { form: token, ...fields }, headers)
  }

  async upload(name: string, archive: Buffer, token?: string): Promise<Answer> {
    const boundary = "----cfboundary7MA4YWxkTrZu0gW"
    const form = token ?? formToken((await this.get("/projects")).text)
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="form"\r\n\r\n${form}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="p.zip"\r\nContent-Type: application/zip\r\n\r\n`,
    ]
    const body = Buffer.concat([Buffer.from(parts.join("")), archive, Buffer.from(`\r\n--${boundary}--\r\n`)])
    return this.keep(await send(this.base, "POST", "/projects/upload", { host: this.host, "content-type": `multipart/form-data; boundary=${boundary}`, origin: ORIGIN, ...this.cookieHeader() }, body))
  }

  async signUp(code: string, email: string, password = "a good password"): Promise<Answer> {
    return this.submit("/signup", "/signup", { code, email, password })
  }

  async signIn(email: string, password = "a good password"): Promise<Answer> {
    return this.submit("/signin", "/signin", { email, password })
  }
}

/** A runner whose workspaces are whatever origin the test gives. */
export function fixedRunner(studio: () => string): WorkspaceRunner {
  return new ManagedRunner({
    launch: async (): Promise<Launched> => ({ address: { studio: studio(), mcp: studio() }, exited: new Promise(() => undefined), stop: async () => undefined }),
    log: () => undefined,
  })
}

export async function startTestHub(options: Partial<HubOptions> = {}): Promise<HubServer> {
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), "cf-hub-")))
  return startHub({ dataDir, port: 0, publicOrigin: ORIGIN, workspaceDomain: WORKSPACE_DOMAIN, log: () => undefined, runner: () => fixedRunner(() => "http://127.0.0.1:9"), ...options })
}

export const WORKSPACE_DOMAIN = "ws.localhost"

/** Project `id`'s own origin in the test hub (the public origin's scheme). */
export function projectOriginOf(id: string, origin = ORIGIN): string {
  return `${new URL(origin).protocol}//${id}.${WORKSPACE_DOMAIN}`
}

/** Adds an invite code straight to the store and returns it. */
export function invite(server: HubServer, code = `code-${Math.random().toString(36).slice(2)}`): string {
  server.hub.store.addInvite(hashSecret(code), Date.now())
  return code
}

/** Signs up a new user in a fresh browser. */
export async function newUser(server: HubServer, email: string): Promise<Browser> {
  const browser = new Browser(server.url)
  const answer = await browser.signUp(invite(server), email)
  if (answer.status !== 303) throw new Error(`sign-up failed: ${answer.status} ${answer.text}`)
  return browser
}
