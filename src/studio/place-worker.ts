// Worker thread that places one board on request (place-runner.ts starts one per run and ends it afterwards).
import { parentPort } from "node:worker_threads"
import { placeBoard } from "../engine/pcb-place/index.js"
import type { PlaceWorkerReply, PlaceWorkerRequest } from "./place-runner.js"

const port = parentPort
if (!port) throw new Error("place-worker must run in a worker thread")

const reply = (message: PlaceWorkerReply) => port.postMessage(message)

port.on("message", (request: PlaceWorkerRequest) => {
  try {
    const placement = placeBoard(request.design, {
      scope: request.scope,
      locked: request.locked,
      ...(request.budgetMs === undefined ? {} : { budgetMs: request.budgetMs }),
      onProgress: (progress) => reply({ type: "progress", progress }),
    })
    reply({ type: "done", placement })
  } catch (error) {
    reply({ type: "error", message: error instanceof Error ? error.message : String(error) })
  }
})
