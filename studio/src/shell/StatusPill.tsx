import type { BuildState } from "../api"
import { blurAfterPointerClick } from "./focus"
import { buildTone, statusText } from "./status-pill"

/** The build state and its error count (error violations and error diagnostics); clicking it opens the DRC tab. */
export function StatusPill({ build, errors, onOpen }: { build: BuildState; errors: number; onOpen(): void }) {
  return (
    <button
      className={`build ${buildTone(build, errors)}`}
      onClick={(event) => {
        blurAfterPointerClick(event)
        onOpen()
      }}
      title="DRC (\)"
    >
      <span className="dot" aria-hidden="true" />
      <span role="status">{statusText(build, errors)}</span>
    </button>
  )
}
