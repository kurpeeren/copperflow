import { describe, expect, test, vi } from "vitest"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import {
  checkEngine,
  containerLauncher,
  containerRunArgs,
  createContainerRunner,
  sweepLeftovers,
  workspaceUser,
  type ChildLike,
  type SpawnLike,
} from "../src/hub/runner/container-runner.js"
import type { WorkspaceSpec } from "../src/hub/runner/runner.js"

const ID = "0123456789abcdef0123456789abcdef"
const KEY = `${"A".repeat(43)}=`
const spec = (id = ID): WorkspaceSpec => ({ id, userId: "u1", projectDir: `/srv/copperflow/projects/u1/${id}`, basePath: "", publicOrigin: `https://${id}.ws.example.com` })

interface FakeChild extends ChildLike {
  args: string[]
  emitter: EventEmitter
  exit(code: number | null): void
}

/** A fake engine command: `answer` decides what each invocation prints and how it ends. */
function fakeEngine(answer: (args: string[], child: FakeChild) => void) {
  const calls: string[][] = []
  const spawn: SpawnLike = (_command, args) => {
    calls.push(args)
    const emitter = new EventEmitter()
    const child: FakeChild = {
      args,
      emitter,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      once: ((event: string, listener: (...values: unknown[]) => void) => emitter.once(event, listener)) as ChildLike["once"],
      kill: () => {
        child.exit(null)
        return true
      },
      exit: (code) => {
        if (child.exitCode !== null || child.signalCode !== null) return
        if (code === null) child.signalCode = "SIGKILL"
        else child.exitCode = code
        ;(child.stdout as PassThrough).end()
        ;(child.stderr as PassThrough).end()
        emitter.emit("exit", code)
      },
    }
    setImmediate(() => answer(args, child))
    return child
  }
  return { spawn, calls }
}

const say = (child: FakeChild, text: string, code = 0) => {
  child.stdout.push(text)
  setImmediate(() => child.exit(code))
}

/** An engine where `run` prints the ready line and stays up until `stop`, and `port` answers loopback ports. */
function healthyEngine(readyLine = '{"studio":"http://0.0.0.0:8080","mcp":"http://0.0.0.0:8081"}\n') {
  const running = new Map<string, FakeChild>()
  const engine = fakeEngine((args, child) => {
    const [verb] = args
    if (verb === "run") {
      running.set(args[args.indexOf("--name") + 1] as string, child)
      child.stdout.push(readyLine)
      return
    }
    if (verb === "port") return say(child, args[2] === "8080/tcp" ? "127.0.0.1:49001\n" : "127.0.0.1:49002\n")
    if (verb === "stop") {
      running.get(args[3] as string)?.exit(0)
      return say(child, "")
    }
    say(child, "")
  })
  return { ...engine, running }
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

describe("the container's argument array", () => {
  test("holds every isolation flag, one mount, one variable, and nothing published beyond loopback", () => {
    const args = containerRunArgs(spec(), { image: "copperflow-workspace", user: "1000:1000" }, KEY)
    expect(args).toEqual([
      "run",
      "--rm",
      "--interactive",
      "--name", `cf-ws-${ID}`,
      "--label", "org.copperflow.workspace=1",
      "--user", "1000:1000",
      "--log-driver", "none",
      "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--pids-limit", "128",
      "--memory", "512m",
      "--memory-swap", "512m",
      "--cpus", "1",
      "--ulimit", "nofile=1024:1024",
      "--network", `cf-ws-${ID}`,
      "--publish", "127.0.0.1::8080",
      "--publish", "127.0.0.1::8081",
      "--mount", `type=bind,source=/srv/copperflow/projects/u1/${ID},target=/work`,
      "--workdir", "/work",
      "--env", `COPPERFLOW_TICKET_PUBLIC_KEY=${KEY}`,
      "copperflow-workspace",
      "--root", "/work",
      "--id", ID,
      "--public-origin", `https://${ID}.ws.example.com`,
      "--base-path", "/",
      "--studio-port", "8080",
      "--mcp-port", "8081",
      "--bind", "0.0.0.0",
      "--stop-on-stdin-end",
    ])
    const flags = args.filter((arg) => arg.startsWith("-"))
    for (const forbidden of ["--privileged", "--pid", "--ipc", "--uts", "--userns", "--cap-add", "--volume", "-v", "-p", "--device", "--env-file", "--volumes-from"]) expect(flags).not.toContain(forbidden)
    expect(args.filter((arg) => arg === "--mount")).toHaveLength(1)
    expect(args.filter((arg) => arg === "--env")).toHaveLength(1)
    expect(args.join(" ")).not.toContain("docker.sock")
    expect(args.filter((arg, i) => args[i - 1] === "--publish").every((value) => value.startsWith("127.0.0.1::"))).toBe(true)
  })

  test("with network reach nothing is published, and limits are options", () => {
    const args = containerRunArgs(spec(), { image: "img", hubContainer: "cf-hub", reach: "network", limits: { memory: "1g", cpus: "0.5", pids: 64, openFiles: 512, tmpSize: "32m" } }, KEY)
    expect(args).not.toContain("--publish")
    expect(args.slice(args.indexOf("--network"), args.indexOf("--network") + 2)).toEqual(["--network", `cf-ws-${ID}`])
    // Two workspaces never share a network.
    const other = containerRunArgs(spec("f".repeat(32)), { image: "img" }, KEY)
    expect(other[other.indexOf("--network") + 1]).toBe(`cf-ws-${"f".repeat(32)}`)
    expect(args).toEqual(expect.arrayContaining(["1g", "0.5", "64", "nofile=512:512", "/tmp:rw,noexec,nosuid,nodev,size=32m"]))
    // The containers run as the hub's own uid:gid (or the image's where the platform has none), never root.
    expect(workspaceUser()).toBe(process.getuid ? `${process.getuid()}:${process.getgid?.()}` : "10001:10001")
    expect(() => workspaceUser("0:0")).toThrow(/root/)
    expect(() => workspaceUser("1000:0")).toThrow(/root/)
    expect(() => workspaceUser("me")).toThrow(/uid/)
    expect(args[args.indexOf("--memory-swap") + 1]).toBe("1g")
  })

  test("refuses hostile ids, folders, origins, networks and limits", () => {
    for (const id of ["../etc", "ABCDEF0123456789abcdef0123456789", `${ID};rm`, "abc", `${ID}\n`, `--privileged`]) expect(() => containerRunArgs(spec(id), { image: "img" }, KEY)).toThrow(/refused/)
    expect(() => containerRunArgs({ ...spec(), projectDir: "/srv/a,readonly=false,source=/" }, { image: "img" }, KEY)).toThrow(/refused/)
    expect(() => containerRunArgs({ ...spec(), projectDir: "relative/dir" }, { image: "img" }, KEY)).toThrow(/refused/)
    expect(() => containerRunArgs({ ...spec(), publicOrigin: "https://x.example.com/path" }, { image: "img" }, KEY)).toThrow(/refused/)
    expect(() => containerRunArgs({ ...spec(), basePath: "/p/x" }, { image: "img" }, KEY)).toThrow(/refused/)
    expect(() => containerRunArgs(spec(), { image: "img", reach: "network" }, KEY)).toThrow(/--hub-container/)
    expect(() => containerRunArgs(spec(), { image: "img", reach: "network", hubContainer: "--net=host" }, KEY)).toThrow(/--hub-container/)
    expect(() => containerRunArgs(spec(), { image: "img", reach: "network", hubContainer: `cf-ws-${ID}` }, KEY)).toThrow(/--hub-container/)
    expect(() => containerRunArgs(spec(), { image: "img", hubContainer: "cf-hub" }, KEY)).toThrow(/--hub-container/)
    expect(() => containerRunArgs(spec(), { image: "--privileged" }, KEY)).toThrow(/image/)
    expect(() => containerRunArgs(spec(), { image: "img", limits: { memory: "0" } }, KEY)).toThrow()
    expect(() => containerRunArgs(spec(), { image: "img", limits: { pids: 1_000_000 } }, KEY)).toThrow()
    expect(() => containerRunArgs(spec(), { image: "img" }, "not a key")).toThrow(/refused/)
  })

  test("a hostile id is refused before any command runs", async () => {
    const engine = healthyEngine()
    const launch = containerLauncher({ image: "img", ticketPublicKey: KEY, spawn: engine.spawn, log: () => undefined })
    await expect(launch(spec("../../etc"))).rejects.toThrow(/refused/)
    expect(engine.calls).toEqual([])
  })
})

describe("launching a container", () => {
  test("reads the ready line, then finds the loopback ports", async () => {
    const engine = healthyEngine()
    const launch = containerLauncher({ image: "img", ticketPublicKey: KEY, spawn: engine.spawn, log: () => undefined })
    const launched = await launch(spec())
    expect(launched.address).toEqual({ studio: "http://127.0.0.1:49001", mcp: "http://127.0.0.1:49002" })
    expect(engine.calls.map((args) => args.slice(0, 3))).toEqual([
      ["network", "rm", `cf-ws-${ID}`],
      ["network", "create", "--internal"],
      ["run", "--rm", "--interactive"],
      ["port", `cf-ws-${ID}`, "8080/tcp"],
      ["port", `cf-ws-${ID}`, "8081/tcp"],
    ])
    expect(engine.calls[1]).toEqual(["network", "create", "--internal", "--driver", "bridge", "--label", "org.copperflow.workspace=1", `cf-ws-${ID}`])
    await launched.stop()
    await launched.exited
    expect(engine.calls.at(-1)).toEqual(["network", "rm", `cf-ws-${ID}`])
  })

  test("with network reach the hub joins the workspace's own network, and the address is the container's name on it", async () => {
    const engine = healthyEngine()
    const launch = containerLauncher({ image: "img", reach: "network", hubContainer: "cf-hub", ticketPublicKey: KEY, spawn: engine.spawn, log: () => undefined })
    const launched = await launch(spec())
    expect(launched.address).toEqual({ studio: `http://cf-ws-${ID}:8080`, mcp: `http://cf-ws-${ID}:8081` })
    expect(engine.calls[2]).toEqual(["network", "connect", `cf-ws-${ID}`, "cf-hub"])
    await launched.stop()
    expect(engine.calls.slice(-2)).toEqual([["network", "disconnect", "--force", `cf-ws-${ID}`, "cf-hub"], ["network", "rm", `cf-ws-${ID}`]])
  })

  test("stopping runs stop -t 5, then rm --force, then removes the network", async () => {
    const engine = healthyEngine()
    const launched = await containerLauncher({ image: "img", reach: "network", hubContainer: "cf-hub", ticketPublicKey: KEY, spawn: engine.spawn, log: () => undefined })(spec())
    await launched.stop()
    const after = engine.calls.slice(engine.calls.findIndex((args) => args[0] === "run") + 1)
    expect(after.slice(0, 2)).toEqual([["stop", "-t", "5", `cf-ws-${ID}`], ["rm", "--force", `cf-ws-${ID}`]])
    expect(after.at(-1)).toEqual(["network", "rm", `cf-ws-${ID}`])
  })

  test("a network that cannot be made stops the launch before any container runs", async () => {
    const engine = fakeEngine((args, child) => say(child, "", args[1] === "create" ? 1 : 0))
    await expect(containerLauncher({ image: "img", ticketPublicKey: KEY, spawn: engine.spawn, log: () => undefined })(spec())).rejects.toThrow(/network could not be created/)
    expect(engine.calls.some((args) => args[0] === "run")).toBe(false)
  })

  test("an unexpected ready line, a port off loopback, an early exit and a timeout each fail and clean up", async () => {
    for (const line of ['{"studio":"http://0.0.0.0:9999","mcp":"http://0.0.0.0:8081"}\n', "not json\n", `${"x".repeat(5000)}`]) {
      const engine = healthyEngine(line)
      await expect(containerLauncher({ image: "img", ticketPublicKey: KEY, spawn: engine.spawn, log: () => undefined })(spec())).rejects.toThrow()
      await wait(20)
      expect(engine.calls.some((args) => args[0] === "rm")).toBe(true)
    }
    const wide = fakeEngine((args, child) => {
      if (args[0] === "run") return void child.stdout.push('{"studio":"http://0.0.0.0:8080","mcp":"http://0.0.0.0:8081"}\n')
      say(child, args[0] === "port" ? "0.0.0.0:49001\n" : "")
    })
    await expect(containerLauncher({ image: "img", ticketPublicKey: KEY, spawn: wide.spawn, log: () => undefined })(spec())).rejects.toThrow(/127\.0\.0\.1/)
    const early = fakeEngine((args, child) => say(child, "", args[0] === "run" ? 125 : 0))
    await expect(containerLauncher({ image: "img", ticketPublicKey: KEY, spawn: early.spawn, log: () => undefined })(spec())).rejects.toThrow(/exited with code 125/)
    const silent = fakeEngine((args, child) => (args[0] === "run" ? undefined : say(child, "")))
    await expect(containerLauncher({ image: "img", ticketPublicKey: KEY, startTimeoutMs: 50, spawn: silent.spawn, log: () => undefined })(spec())).rejects.toThrow(/no address within 50 ms/)
    await wait(20)
    expect(silent.calls.map((args) => args[0]).slice(2, 5)).toEqual(["run", "stop", "rm"])
  })

  test("standard error reaches the log up to its cap", async () => {
    const lines: string[] = []
    const engine = fakeEngine((args, child) => {
      if (args[0] !== "run") return say(child, "")
      child.stderr.push(`${"e".repeat(80)}\n`.repeat(10))
      setTimeout(() => child.stdout.push('{"studio":"http://0.0.0.0:8080","mcp":"http://0.0.0.0:8081"}\n'), 20)
    })
    const launched = await containerLauncher({ image: "img", reach: "network", hubContainer: "cf-hub", ticketPublicKey: KEY, logCapBytes: 200, spawn: engine.spawn, log: (line) => lines.push(line) })(spec())
    expect(lines.filter((line) => line.includes("eeee")).join("").length).toBeLessThan(400)
    expect(lines.at(-1)).toMatch(/log cap of 200 bytes reached/)
    await launched.stop()
  })

  test("a crashed container is restarted once by the managed runner", async () => {
    const engine = healthyEngine()
    const runner = createContainerRunner({ image: "img", reach: "network", hubContainer: "cf-hub", ticketPublicKey: KEY, spawn: engine.spawn, log: () => undefined })
    await runner.ensure(spec())
    const runs = () => engine.calls.filter((args) => args[0] === "run").length
    // The container dies: its `docker run` process ends without being asked to.
    engine.running.get(`cf-ws-${ID}`)?.exit(137)
    await vi.waitFor(() => expect(runner.state(ID)).toBe("running"), { timeout: 5000 })
    await vi.waitFor(() => expect(runs()).toBe(2), { timeout: 5000 })
    engine.running.get(`cf-ws-${ID}`)?.exit(137)
    await vi.waitFor(() => expect(runner.state(ID)).toBe("failed"), { timeout: 5000 })
    expect(runs()).toBe(2)
    await runner.stopAll()
  })

  test("idle containers are stopped and started again on demand", async () => {
    const engine = healthyEngine()
    const runner = createContainerRunner({ image: "img", reach: "network", hubContainer: "cf-hub", ticketPublicKey: KEY, idleMs: 40, spawn: engine.spawn, log: () => undefined })
    await runner.ensure(spec())
    await wait(150)
    expect(runner.state(ID)).toBe("stopped")
    expect(engine.calls.some((args) => args[0] === "stop")).toBe(true)
    await runner.ensure(spec())
    expect(runner.state(ID)).toBe("running")
    expect(engine.calls.filter((args) => args[0] === "run")).toHaveLength(2)
    await runner.stopAll()
  })
})

describe("before the hub starts", () => {
  test("refuses when the engine does not answer, or the image is missing, with how to build it", async () => {
    const down = fakeEngine((_args, child) => say(child, "", 1))
    await expect(checkEngine({ image: "img" }, down.spawn)).rejects.toThrow(/does not answer/)
    const noImage = fakeEngine((args, child) => say(child, args[0] === "version" ? "28.0.1\n" : "", args[0] === "image" ? 1 : 0))
    await expect(checkEngine({ image: "img" }, noImage.spawn)).rejects.toThrow(/docker build -f deploy\/workspace.Dockerfile/)
  })

  test("probes what the reach needs on an internal network, and refuses a spawn error without leaking the network", async () => {
    const answer = (args: string[]) => (args[0] === "version" ? "27.1.0\n" : args[0] === "image" ? "node@sha256:x\n" : args[0] === "port" ? "127.0.0.1:49000\n" : "")
    const fine = fakeEngine((args, child) => say(child, answer(args)))
    expect(await checkEngine({ image: "img", user: "1000:1000" }, fine.spawn)).toEqual([])
    expect(fine.calls.slice(2).map((args) => args.slice(0, 2))).toEqual([["network", "create"], ["run", "--detach"], ["port", `cf-check-${process.pid}`], ["rm", "--force"], ["network", "rm"]])
    expect(fine.calls[3]).toEqual(expect.arrayContaining(["--network", `cf-check-${process.pid}`, "--publish", "127.0.0.1::8080", "--log-driver", "none"]))
    const joined = fakeEngine((args, child) => say(child, answer(args)))
    await checkEngine({ image: "img", reach: "network", hubContainer: "cf-hub", user: "1000:1000" }, joined.spawn)
    expect(joined.calls.slice(2).map((args) => args.slice(0, 2))).toEqual([["network", "create"], ["network", "connect"], ["network", "disconnect"], ["network", "rm"]])
    const cannot = fakeEngine((args, child) => say(child, answer(args), args[1] === "create" ? 1 : 0))
    await expect(checkEngine({ image: "img", user: "1000:1000" }, cannot.spawn)).rejects.toThrow(/could not create an internal network/)
    const podman = fakeEngine((args, child) => say(child, args[0] === "version" ? "4.9.3\n" : answer(args)))
    await expect(checkEngine({ image: "img", command: "podman", user: "1000:1000" }, podman.spawn)).rejects.toThrow(/Podman 5 or newer/)
  })

  test("a spawn error on launch still removes the workspace's network", async () => {
    const engine = fakeEngine((args, child) => {
      if (args[0] === "run") return void child.emitter.emit("error", new Error("ENOENT"))
      say(child, "")
    })
    await expect(containerLauncher({ image: "img", ticketPublicKey: KEY, user: "1000:1000", spawn: engine.spawn, log: () => undefined })(spec())).rejects.toThrow(/ENOENT/)
    await vi.waitFor(() => expect(engine.calls.at(-1)).toEqual(["network", "rm", `cf-ws-${ID}`]))
  })

  test("the sweep removes leftover workspace containers and networks and nothing else", async () => {
    const listing = `cf-ws-${ID}\ncf-ws-evil;rm\nother\ncf-ws-${"f".repeat(32)}\n`
    const engine = fakeEngine((args, child) => say(child, args[0] === "ps" || args[1] === "ls" ? listing : ""))
    expect(await sweepLeftovers({ image: "img" }, engine.spawn)).toBe(2)
    expect(engine.calls).toEqual([
      ["ps", "--all", "--filter", "label=org.copperflow.workspace=1", "--filter", "name=^cf-ws-", "--format", "{{.Names}}"],
      ["rm", "--force", `cf-ws-${ID}`],
      ["rm", "--force", `cf-ws-${"f".repeat(32)}`],
      ["network", "ls", "--filter", "label=org.copperflow.workspace=1", "--format", "{{.Name}}"],
      ["network", "rm", `cf-ws-${ID}`],
      ["network", "rm", `cf-ws-${"f".repeat(32)}`],
    ])
  })
})
