// The container runner against a real engine. These run only when `docker version` answers; otherwise the whole file
// is skipped with one line saying so (no engine is ever started by the tests).
import { describe, expect, test } from "vitest"
import { spawnSync } from "node:child_process"
import { request } from "node:http"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateTicketKeys, signTicket, TICKET_HEADER } from "../src/hosted/ticket.js"
import { checkEngine, containerRunArgs, createContainerRunner, networkCreateArgs, sweepLeftovers } from "../src/hub/runner/container-runner.js"
import { BOARD } from "./fixtures.js"

const IMAGE = "copperflow-workspace:test"
const engineUp = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", windowsHide: true }).status === 0
if (!engineUp) process.stdout.write("hub-container-engine.test.ts: skipped, because no container engine is running (`docker version` did not answer)\n")

const projectId = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")
const docker = (args: string[], timeout = 120_000) => spawnSync("docker", args, { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 })

/**
 * Runs a Node script inside a container started with exactly the runner's flags, only the entrypoint swapped. The
 * engine's `node:vm` guard is not the boundary under test here: this is what circuit code that escaped it could do.
 */
function probe(id: string, projectDir: string, script: string, publicKey: string, timeout = 120_000) {
  const args = containerRunArgs({ id, userId: "u", projectDir, basePath: "", publicOrigin: `https://${id}.ws.localhost` }, { image: IMAGE }, publicKey)
  const at = args.indexOf(IMAGE)
  docker(networkCreateArgs(`cf-ws-${id}`))
  try {
    return docker([...args.slice(0, at).filter((arg) => arg !== "--interactive"), "--entrypoint", "node", IMAGE, "-e", script], timeout)
  } finally {
    docker(["network", "rm", `cf-ws-${id}`])
  }
}

describe.skipIf(!engineUp)("the container runner with a real engine", () => {
  const keys = generateTicketKeys()

  test("builds the image", () => {
    const built = docker(["build", "-f", "deploy/workspace.Dockerfile", "-t", IMAGE, "."], 900_000)
    expect(built.status, built.stderr).toBe(0)
  }, 900_000)

  test("passes the engine checks, sweeps leftovers, and serves a workspace's circuits", async () => {
    await checkEngine({ image: IMAGE })
    await sweepLeftovers({ image: IMAGE })
    const id = projectId()
    const dir = await mkdtemp(join(tmpdir(), "cf-ctr-"))
    await writeFile(join(dir, "main.circuit.tsx"), BOARD)
    const runner = createContainerRunner({ image: IMAGE, reach: "loopback", ticketPublicKey: keys.publicKeyBase64, log: () => undefined })
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
    } finally {
      await runner.stopAll()
    }
  }, 180_000)

  test("reads nothing of the host outside /work", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-ctr-"))
    const out = probe(projectId(), dir, `const fs=require("fs");const r=(p)=>{try{return fs.readFileSync(p,"utf8")}catch(e){return "ERR "+e.code}};console.log(JSON.stringify({env:r("/proc/1/environ"),data:r(${JSON.stringify(process.cwd())}),root:fs.readdirSync("/")}))`, keys.publicKeyBase64)
    const seen = JSON.parse(out.stdout) as { env: string; data: string; root: string[] }
    expect(seen.env.split("\0").filter((line) => line !== "").map((line) => line.split("=")[0]).sort()).toEqual(expect.arrayContaining(["COPPERFLOW_TICKET_PUBLIC_KEY"]))
    expect(seen.env).not.toMatch(/PRIVATE|SECRET|TOKEN|PASSWORD/i)
    expect(seen.data).toMatch(/^ERR/)
  }, 120_000)

  test("opens no network connection and resolves no name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-ctr-"))
    // Each workspace's network has its own gateway; the probe reads its default-route gateway from inside.
    const gateway = "172.17.0.1"
    const script = `const net=require("net"),dns=require("dns");const tcp=(h,p)=>new Promise(d=>{const s=net.connect({host:h,port:p,timeout:3000});s.on("connect",()=>{s.destroy();d("open")});s.on("timeout",()=>{s.destroy();d("timeout")});s.on("error",e=>d("ERR "+e.code))});(async()=>{const a=await tcp("1.1.1.1",443),b=await tcp(${JSON.stringify(gateway || "172.17.0.1")},80),c=await new Promise(d=>dns.lookup("example.com",e=>d(e?"ERR "+e.code:"resolved")));console.log(JSON.stringify([a,b,c]))})()`
    const results = JSON.parse(probe(projectId(), dir, script, keys.publicKeyBase64).stdout) as string[]
    for (const result of results) expect(result).not.toBe("open")
    expect(results[2]).not.toBe("resolved")
  }, 120_000)

  test("one workspace cannot connect to another workspace's servers", async () => {
    const runner = createContainerRunner({ image: IMAGE, reach: "loopback", ticketPublicKey: keys.publicKeyBase64, log: () => undefined })
    const target = projectId()
    try {
      const dir = await mkdtemp(join(tmpdir(), "cf-ctr-"))
      await writeFile(join(dir, "main.circuit.tsx"), BOARD)
      await runner.ensure({ id: target, userId: "u2", projectDir: dir, basePath: "", publicOrigin: `https://${target}.ws.localhost` })
      const address = docker(["inspect", "--format", `{{(index .NetworkSettings.Networks "cf-ws-${target}").IPAddress}}`, `cf-ws-${target}`]).stdout.trim()
      const script = `const net=require("net");const t=(h)=>new Promise(d=>{const s=net.connect({host:h,port:8080,timeout:3000});s.on("connect",()=>{s.destroy();d("open")});s.on("timeout",()=>{s.destroy();d("timeout")});s.on("error",e=>d("ERR "+e.code))});Promise.all([t(${JSON.stringify(address)}),t("cf-ws-${target}")]).then(r=>console.log(JSON.stringify(r)))`
      const results = JSON.parse(probe(projectId(), await mkdtemp(join(tmpdir(), "cf-ctr-")), script, keys.publicKeyBase64).stdout) as string[]
      for (const result of results) expect(result).not.toBe("open")
    } finally {
      await runner.stopAll()
    }
  }, 180_000)

  test("allocating without bound is stopped at the memory limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-ctr-"))
    const out = probe(projectId(), dir, `const k=[];for(;;)k.push(Buffer.alloc(16*1024*1024,1))`, keys.publicKeyBase64)
    expect(out.status).not.toBe(0)
  }, 120_000)

  test("spawning without bound is stopped at the pids limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-ctr-"))
    const script = `const {spawn}=require("child_process");let n=0,err="";for(let i=0;i<400;i++){try{const c=spawn("sleep",["30"]);c.on("error",e=>{err=e.code});n++}catch(e){err=e.code;break}}setTimeout(()=>{console.log(JSON.stringify({n,err}));process.exit(0)},2000)`
    const seen = JSON.parse(probe(projectId(), dir, script, keys.publicKeyBase64).stdout) as { n: number; err: string }
    expect(seen.err).not.toBe("")
  }, 120_000)

  test("writes outside /work are refused and /tmp is capped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-ctr-"))
    const script = `const fs=require("fs");const w=(p,d)=>{try{fs.writeFileSync(p,d);return "ok"}catch(e){return "ERR "+e.code}};const big=Buffer.alloc(8*1024*1024);let t="ok";for(let i=0;i<20&&t==="ok";i++)t=w("/tmp/f"+i,big);console.log(JSON.stringify({etc:w("/etc/x","x"),app:w("/app/x","x"),tmp:t,work:w("/work/ok.txt","x")}))`
    const seen = JSON.parse(probe(projectId(), dir, script, keys.publicKeyBase64).stdout) as Record<string, string>
    expect(seen.etc).toMatch(/^ERR/)
    expect(seen.app).toMatch(/^ERR/)
    expect(seen.tmp).toMatch(/ENOSPC/)
    expect(seen.work).toBe("ok")
  }, 120_000)

  test("another workspace's folder is not visible", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cf-ctr-"))
    const mine = join(parent, "a")
    const theirs = join(parent, "b")
    await import("node:fs/promises").then((fs) => Promise.all([fs.mkdir(mine), fs.mkdir(theirs)]))
    await writeFile(join(theirs, "secret.circuit.tsx"), BOARD)
    const out = probe(projectId(), mine, `const fs=require("fs");console.log(JSON.stringify({up:fs.readdirSync("/work/.."),work:fs.readdirSync("/work")}))`, keys.publicKeyBase64)
    const seen = JSON.parse(out.stdout) as { up: string[]; work: string[] }
    expect(seen.up).not.toContain("b")
    expect(seen.work).toEqual([])
    expect(await readdir(theirs)).toEqual(["secret.circuit.tsx"])
  }, 120_000)
})
