// Worker thread that routes one board on request (route-runner.ts starts one per run and ends it afterwards). It runs
// only inside a worker, so tests cover the routing through routeBoard and the runner through a worker double.
import { parentPort } from "node:worker_threads"
import { routeBoard } from "../engine/router/route-board.js"
import type { RouteWorkerReply, RouteWorkerRequest } from "./route-runner.js"

const port = parentPort
if (!port) throw new Error("router-worker must run in a worker thread")

const reply = (message: RouteWorkerReply) => port.postMessage(message)

port.on("message", (request: RouteWorkerRequest) => {
  try {
    reply({ type: "done", report: routeBoard(request.input, { scope: request.scope, ...(request.budgetMs === undefined ? {} : { budgetMs: request.budgetMs }), onProgress: (progress) => reply({ type: "progress", progress }) }) })
  } catch (error) {
    reply({ type: "error", message: error instanceof Error ? error.message : String(error) })
  }
})
