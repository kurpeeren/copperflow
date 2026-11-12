// The container runner against a real engine. These run only when `docker version` answers; otherwise the whole file
// is skipped with one line saying so (no engine is ever started by the tests). Every hostile case runs a Node script
// inside a container started with exactly the runner's flags, the entrypoint swapped: this is what circuit code that
// escaped the engine's `node:vm` guard could do. The guard itself is not the boundary under test.
import { describe, expect, test } from "vitest"
import { spawnSync } from "node:child_process"
import { request } from "node:http"
import { mkdir, mkdtemp, readdir, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { generateTicketKeys, signTicket, TICKET_HEADER } from "../src/hosted/ticket.js"
import { removeProjectFolders } from "../src/hub/project-folders.js"
import { ProjectFiles } from "../src/hub/projects.js"
import { withProjectLock } from "../src/hub/quota.js"
import { checkEngine, containerRunArgs, createContainerRunner, networkCreateArgs, sweepLeftovers } from "../src/hub/runner/container-runner.js"
import { shareWithWorkspaceGroup } from "../src/hub/safe-files.js"
import { BOARD } from "./fixtures.js"

const IMAGE = "copperflow-workspace:test"
const engineUp = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", windowsHide: true }).status === 0
if (!engineUp) process.stdout.write("hub-container-engine.test.ts: skipped, because no container engine is running (`docker version` did not answer)\n")

const GROUP = String(process.getgid?.() ?? 1000)
const SETTINGS = { image: IMAGE, group: GROUP }
const USER = "a".repeat(32)
const projectId = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")
const docker = (args: string[], timeout = 120_000) => spawnSync("docker", args, { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 })

/** A folder like a project's: the workspace group, mode 2770. */
async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cf-ctr-"))
  await shareWithWorkspaceGroup(dir, Number(GROUP))
  return dir
}

/** Runs a Node script inside a container started with exactly the runner's flags, only the entrypoint swapped. */
function probe(id: string, projectDir: string, script: string, publicKey: string, timeout = 120_000) {
  const args = containerRunArgs({ id, userId: "u", projectDir, basePath: "", publicOrigin: `https://${id}.ws.localhost` }, SETTINGS, publicKey)
  const at = args.indexOf(IMAGE)
  docker(networkCreateArgs(`cf-ws-${id}`))
  try {
    return docker([...args.slice(0, at).filter((arg) => arg !== "--interactive" && arg !== "--rm"), "--entrypoint", "node", IMAGE, "-e", script], timeout)
  } finally {
    docker(["rm", "--force", `cf-ws-${id}`])
    docker(["network", "rm", `cf-ws-${id}`])
  }
}

const json = <T>(out: { stdout: string }) => JSON.parse(out.stdout.trim().split("\n").at(-1) as string) as T
const TCP = `const net=require("net");const tcp=(h,p)=>new Promise(d=>{const s=net.connect({host:h,port:p,timeout:3000});s.on("connect",()=>{s.destroy();d("open")});s.on("timeout",()=>{s.destroy();d("timeout")});s.on("error",e=>d("ERR "+e.code))});`

describe.skipIf(!engineUp)("the container runner with a real engine", () => {
  const keys = generateTicketKeys()

  test("builds the image", () => {
    const built = docker(["build", "-f", "deploy/workspace.Dockerfile", "-t", IMAGE, "."], 900_000)
    expect(built.status, built.stderr).toBe(0)
  }, 900_000)

  test("passes the engine checks (version, image, publishing on an internal network), sweeps leftovers, and serves a workspace", async () => {
    await checkEngine(SETTINGS)
    await sweepLeftovers(SETTINGS)
    const id = projectId()
    const dir = await folder()
    await writeFile(join(dir, "main.circuit.tsx"), BOARD)
    const runner = createContainerRunner({ ...SETTINGS, reach: "loopback", ticketPublicKey: keys.publicKeyBase64, log: () => undefined })
    try {
      const address = await runner.ensure({ id, userId: "u1", projectDir: dir, basePath: "", publicOrigin: `https://${id}.ws.localhost` })
      const now = Math.floor(Date.now() / 1000)
      const ticket = signTicket({ w: id, u: "u1", iat: now, exp: now + 60 }, keys.privateKey)
      const body = await new Promise<string>((done, fail) => {
        const req = request({ host: "127.0.0.1", port: new URL(address.studio).port, path: "/api/circuits", headers: { host: `${id}.ws.localhost`, [TICKET_HEADER]: ticket } }, (res) => {
          let text = ""
          res.setEncoding("utf8")
          res.on("data", (chunk: string) => (text += chunk))
          res.on("end", () => done(text))
        })
        req.on("error", fail)
        req.end()
      })
      expect(body).toContain("main.circuit.tsx")
      const ports = docker(["port", `cf-ws-${id}`]).stdout.split("\n").filter((line) => line.trim() !== "")
      expect(ports.length).toBeGreaterThan(0)
      expect(ports.every((line) => line.includes("127.0.0.1:"))).toBe(true)
      // No engine log is kept for a workspace container.
      expect(docker(["inspect", "--format", "{{.HostConfig.LogConfig.Type}}", `cf-ws-${id}`]).stdout.trim()).toBe("none")
    } finally {
      await runner.stopAll()
    }
  }, 180_000)

  test("reads nothing of the host outside /work; runs as uid 10001 in the workspace group; the environment holds only the public key and the engine's own", async () => {
    const out = probe(projectId(), await folder(), `const fs=require("fs");const r=(p)=>{try{return fs.readFileSync(p,"utf8")}catch(e){return "ERR "+e.code}};console.log(JSON.stringify({env:r("/proc/1/environ"),data:r(${JSON.stringify(process.cwd())}),uid:process.getuid(),gid:process.getgid()}))`, keys.publicKeyBase64)
    const seen = json<{ env: string; data: string; uid: number; gid: number }>(out)
    const names = seen.env.split("\0").filter((line) => line !== "").map((line) => line.split("=")[0])
    for (const name of names) expect(["COPPERFLOW_TICKET_PUBLIC_KEY", "PATH", "HOSTNAME", "HOME", "NODE_ENV", "NODE_VERSION", "YARN_VERSION", "NPM_CONFIG_CACHE"]).toContain(name)
    expect(seen.data).toMatch(/^ERR/)
    expect(seen.uid).toBe(10001)
    expect(seen.gid).toBe(Number(GROUP))
    expect(seen.uid).not.toBe(process.getuid?.())
  }, 120_000)

  test("kernel interfaces, mounts, namespaces, device nodes, chown and setuid programs are refused", async () => {
    const script = `const fs=require("fs"),cp=require("child_process");const w=(p)=>{try{fs.writeFileSync(p,"1");return "ok"}catch(e){return "ERR "+e.code}};const run=(c,a)=>{const r=cp.spawnSync(c,a,{encoding:"utf8"});return r.status===0?"ok":"ERR "+(r.status??r.error?.code)};console.log(JSON.stringify({sysctl:w("/proc/sys/kernel/hostname"),sys:w("/sys/kernel/mm/ksm/run"),sysrq:w("/proc/sysrq-trigger"),mount:run("mount",["-t","tmpfs","x","/tmp"]),unshare:run("unshare",["-Ur","true"]),mknod:run("mknod",["/tmp/n","c","1","3"]),chown:run("chown",["0:0","/work"]),setuid:run("su",["-c","true"])}))`
    const seen = json<Record<string, string>>(probe(projectId(), await folder(), script, keys.publicKeyBase64))
    for (const [what, result] of Object.entries(seen)) expect(result, what).not.toBe("ok")
  }, 120_000)

  test("opens no connection and resolves no name: public v4 and v6, host ::1, the bridge, the metadata address, the default route, DNS through 127.0.0.11", async () => {
    const script = `${TCP}const dns=require("dns");const gw=require("fs").readFileSync("/proc/net/route","utf8").split("\\n").slice(1).map(l=>l.split("\\t")).find(c=>c[1]==="00000000");(async()=>{const r={public:await tcp("1.1.1.1",443),v6:await tcp("2606:4700:4700::1111",443),v6local:await tcp("::1",22),bridge:await tcp("172.17.0.1",80),metadata:await tcp("169.254.169.254",80),route:gw?"has a default route":"no default route",dns:await new Promise(d=>dns.lookup("example.com",e=>d(e?"ERR "+e.code:"resolved"))),resolver:await new Promise(d=>{const s=new dns.Resolver();s.setServers(["127.0.0.11"]);s.resolve4("example.com",e=>d(e?"ERR "+e.code:"resolved"))})};console.log(JSON.stringify(r))})()`
    const seen = json<Record<string, string>>(probe(projectId(), await folder(), script, keys.publicKeyBase64))
    for (const [what, result] of Object.entries(seen)) expect(result, what).not.toMatch(/^(open|resolved|has a default route)$/)
  }, 120_000)

  test("one workspace cannot connect to another workspace's servers or resolve its name", async () => {
    const runner = createContainerRunner({ ...SETTINGS, reach: "loopback", ticketPublicKey: keys.publicKeyBase64, log: () => undefined })
    const target = projectId()
    try {
      const dir = await folder()
      await writeFile(join(dir, "main.circuit.tsx"), BOARD)
      await runner.ensure({ id: target, userId: "u2", projectDir: dir, basePath: "", publicOrigin: `https://${target}.ws.localhost` })
      const address = docker(["inspect", "--format", `{{(index .NetworkSettings.Networks "cf-ws-${target}").IPAddress}}`, `cf-ws-${target}`]).stdout.trim()
      const script = `${TCP}Promise.all([tcp(${JSON.stringify(address)},8080),tcp("cf-ws-${target}",8080)]).then(r=>console.log(JSON.stringify(r)))`
      for (const result of json<string[]>(probe(projectId(), await folder(), script, keys.publicKeyBase64))) expect(result).not.toBe("open")
    } finally {
      await runner.stopAll()
    }
  }, 180_000)

  test("unbounded allocation in a 256 MB worker ends as an out-of-memory error, and in the main thread at the container's limit", async () => {
    const dir = await folder()
    expect(probe(projectId(), dir, `const k=[];for(;;)k.push(Buffer.alloc(16*1024*1024,1))`, keys.publicKeyBase64).status).not.toBe(0)
    const worker = `const {Worker}=require("worker_threads");const w=new Worker("const k=[];for(;;)k.push(new Array(1e6).fill(1))",{eval:true,resourceLimits:{maxOldGenerationSizeMb:256}});w.on("error",e=>{console.log(JSON.stringify({code:e.code}));process.exit(0)});w.on("exit",c=>{console.log(JSON.stringify({code:"exit "+c}));process.exit(0)})`
    expect(json<{ code: string }>(probe(projectId(), dir, worker, keys.publicKeyBase64)).code).toBe("ERR_WORKER_OUT_OF_MEMORY")
  }, 120_000)

  test("spawning without bound is stopped at the pids limit", async () => {
    const script = `const {spawn}=require("child_process");let err="";for(let i=0;i<400;i++){try{const c=spawn("sleep",["30"]);c.on("error",e=>{err=e.code})}catch(e){err=e.code;break}}setTimeout(()=>{console.log(JSON.stringify({err}));process.exit(0)},2000)`
    expect(json<{ err: string }>(probe(projectId(), await folder(), script, keys.publicKeyBase64)).err).not.toBe("")
  }, 120_000)

  test("writes outside /work are refused, /tmp is capped and not executable, and /work is writable as uid 10001 with the group kept", async () => {
    const script = `const fs=require("fs"),cp=require("child_process");const w=(p,d)=>{try{fs.writeFileSync(p,d);return "ok"}catch(e){return "ERR "+e.code}};fs.writeFileSync("/tmp/x.sh","#!/bin/sh\\necho hi\\n",{mode:0o755});const exec=cp.spawnSync("/tmp/x.sh").error?.code??"ran";const big=Buffer.alloc(8*1024*1024);let t="ok";for(let i=0;i<20&&t==="ok";i++)t=w("/tmp/f"+i,big);console.log(JSON.stringify({etc:w("/etc/x","x"),app:w("/app/x","x"),tmp:t,exec,work:w("/work/ok.txt","x")}))`
    const dir = await folder()
    const seen = json<Record<string, string>>(probe(projectId(), dir, script, keys.publicKeyBase64))
    expect(seen.etc).toMatch(/^ERR/)
    expect(seen.app).toMatch(/^ERR/)
    expect(seen.tmp).toMatch(/ENOSPC/)
    expect(seen.exec).not.toBe("ran")
    expect(seen.work).toBe("ok")
  }, 120_000)

  test("another workspace's folder is not visible", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cf-ctr-"))
    const mine = join(parent, "a")
    const theirs = join(parent, "b")
    await mkdir(mine)
    await mkdir(theirs)
    await shareWithWorkspaceGroup(mine, Number(GROUP))
    await writeFile(join(theirs, "secret.circuit.tsx"), BOARD)
    const seen = json<{ up: string[]; work: string[] }>(probe(projectId(), mine, `const fs=require("fs");let up=[];try{up=fs.readdirSync("/work/..")}catch{};console.log(JSON.stringify({up,work:fs.readdirSync("/work")}))`, keys.publicKeyBase64))
    expect(seen.up).not.toContain("b")
    expect(seen.work).toEqual([])
    expect(await readdir(theirs)).toEqual(["secret.circuit.tsx"])
  }, 120_000)

  test("an owner-only tree a workspace made is still removed by the cleaning container, and its space freed", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-clean-"))
    const files = new ProjectFiles(data)
    files.workspaceGroup = Number(GROUP)
    const id = projectId()
    const dir = await files.create(USER, id)
    const made = probe(id, dir, `const fs=require("fs");fs.mkdirSync("/work/a/b",{recursive:true});fs.writeFileSync("/work/a/b/f",Buffer.alloc(1e6));fs.chmodSync("/work/a/b",0o700);fs.chmodSync("/work/a",0o700);console.log("{}")`, keys.publicKeyBase64)
    expect(made.status).toBe(0)
    const runner = createContainerRunner({ ...SETTINGS, reach: "loopback", ticketPublicKey: keys.publicKeyBase64, log: () => undefined })
    await removeProjectFolders({ runner, files }, USER, [id])
    expect(await readdir(files.trash).catch(() => [])).toEqual([])
    expect(await files.measureUser(USER)).toEqual({ bytes: 0 })
  }, 180_000)

  test("races: with a running workspace and a planted link, a download and a deletion never read or remove a host path", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-race-"))
    const outside = join(data, "outside")
    await mkdir(outside)
    await writeFile(join(outside, "host-secret.txt"), "HOST")
    const files = new ProjectFiles(data)
    files.workspaceGroup = Number(GROUP)
    const id = projectId()
    const dir = await files.create(USER, id)
    await writeFile(join(dir, "main.circuit.tsx"), BOARD)
    await symlink(outside, join(dir, "planted"), "dir")
    const runner = createContainerRunner({ ...SETTINGS, reach: "loopback", ticketPublicKey: keys.publicKeyBase64, log: () => undefined })
    const spec = { id, userId: USER, projectDir: dir, basePath: "", publicOrigin: `https://${id}.ws.localhost` }
    try {
      await runner.ensure(spec)
      const chunks: Buffer[] = []
      const out = new PassThrough()
      out.on("data", (chunk: Buffer) => chunks.push(chunk))
      // The lock stops the workspace and the engine confirms it gone before a byte is read.
      await withProjectLock({ runner }, id, async () => {
        expect(docker(["ps", "--all", "--filter", `name=^cf-ws-${id}$`, "--format", "{{.Names}}"]).stdout.trim()).toBe("")
        await files.download(USER, id, out)
      })
      expect(Buffer.concat(chunks).toString("latin1")).not.toContain("HOST")
      await removeProjectFolders({ runner, files }, USER, [id])
      expect(await readdir(outside)).toEqual(["host-secret.txt"])
    } finally {
      await runner.stopAll()
    }
  }, 180_000)
})
