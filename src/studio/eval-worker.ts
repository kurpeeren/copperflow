// Worker thread that keeps tscircuit's eval library loaded and builds circuits on request.
import { pathToFileURL } from "node:url"
import { parentPort, workerData } from "node:worker_threads"

interface Request {
  id: number
  fsMap: Record<string, string>
  main: string
}

interface Runner {
  setDisableCdnLoading(disable: boolean): Promise<void>
  executeWithFsMap(options: { fsMap: Record<string, string>; mainComponentPath: string }): Promise<void>
  renderUntilSettled(): Promise<void>
  getCircuitJson(): Promise<unknown[]>
}

type RunnerClass = new () => Runner

const port = parentPort
if (!port) throw new Error("eval-worker must run in a worker thread")

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function build(CircuitRunner: RunnerClass, request: Request): Promise<void> {
  try {
    const runner = new CircuitRunner()
    // npm imports must come from the project, as with `tsci build`, never from a CDN.
    await runner.setDisableCdnLoading(true)
    await runner.executeWithFsMap({ fsMap: request.fsMap, mainComponentPath: request.main })
    await runner.renderUntilSettled()
    port?.postMessage({ type: "result", id: request.id, json: await runner.getCircuitJson() })
  } catch (error) {
    port?.postMessage({ type: "error", id: request.id, message: messageOf(error) })
  }
}

try {
  const module = (await import(pathToFileURL(String(workerData.evalEntry)).href)) as { CircuitRunner?: RunnerClass }
  const CircuitRunner = module.CircuitRunner
  if (typeof CircuitRunner !== "function") throw new Error("the eval library has no CircuitRunner")
  port.on("message", (request: Request) => void build(CircuitRunner, request))
  port.postMessage({ type: "ready" })
} catch (error) {
  port.postMessage({ type: "failed", message: messageOf(error) })
}
