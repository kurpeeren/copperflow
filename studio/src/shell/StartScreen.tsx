import { AGENT_LINE, NO_CIRCUIT_TEXT } from "./canvas-notice"
import type { CommandId } from "./menus"

/** The canvas of a project with no circuit file: the two ways to start one, as File → New circuit and Import board. */
export function StartScreen({ run }: { run(command: CommandId): void }) {
  return (
    <div className="start-screen">
      <p>{NO_CIRCUIT_TEXT}</p>
      <div className="start-actions">
        <button type="button" onClick={() => run("newCircuit")}>
          New circuit…
        </button>
        <button type="button" onClick={() => run("importBoardDxf")}>
          Import a board…
        </button>
      </div>
      <p className="note">{AGENT_LINE}</p>
    </div>
  )
}
