// What the build status pill at the right end of the menu bar says, and its colour.
import type { BuildState } from "../api.js"

export function statusText(build: BuildState, errors: number): string {
  if (build.status === "building") return "Building"
  if (build.status === "failed") return "Build failed"
  if (build.status !== "done" || !build.design) return "Not built"
  return errors === 0 ? "Build OK" : `${errors} ${errors === 1 ? "error" : "errors"}`
}

export function buildTone(build: BuildState, errors: number): "busy" | "bad" | "good" | "idle" {
  if (build.status === "building") return "busy"
  if (build.status === "failed" || errors > 0) return "bad"
  return build.status === "done" ? "good" : "idle"
}
