// Worker thread that builds designs on request. It runs only inside a worker, so tests cover it through buildDesign.
import { parentPort } from "node:worker_threads"
import { buildDesign } from "./design.js"
import { CircuitCodeError } from "./evaluate.js"

interface Request {
  id: number
  files: Record<string, string>
  main: string
}

const port = parentPort
if (!port) throw new Error("engine-worker must run in a worker thread")

port.on("message", (request: Request) => {
  try {
    port.postMessage({ id: request.id, design: buildDesign(request.files, request.main) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    port.postMessage({ id: request.id, error: { message, code: error instanceof CircuitCodeError ? "circuit-code" : "internal" } })
  }
})
