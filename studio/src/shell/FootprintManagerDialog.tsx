import { useId, useMemo, useState, type FormEvent } from "react"
import { footprintEdits, footprintRows, usedFootprints, type FootprintSource } from "./footprint-manager"
import type { Edit } from "../api"
import { managerChange } from "./packages-choice"
import { packagesRequests } from "./packages-request"

/** The footprint field and its browse button side by side in the row's cell. */
const FIELD_WITH_BUTTON = { display: "flex", gap: 4 } as const

/** What Tools → Footprint manager… reads and writes: the open design's parts, and one edit list for the changes. */
export interface FootprintPanel {
  source: FootprintSource | undefined
  write(edits: Edit[], summary: string): Promise<boolean>
}

/** Tools → Footprint manager…: every part with its footprint; Save writes the changed ones as one history entry. */
export function FootprintManagerForm({ panel, onClose }: { panel: FootprintPanel; onClose(): void }) {
  const rows = useMemo(() => (panel.source ? footprintRows(panel.source) : []), [panel.source])
  const [changes, setChanges] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string>()
  const list = useId()
  if (rows.length === 0) return <p>The open circuit has no parts yet.</p>
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const plan = footprintEdits(rows, changes)
    if ("message" in plan) return setProblem(plan.message)
    if (await panel.write(plan.edits, plan.summary)) onClose()
  }
  return (
    <form className="footprint-manager" onSubmit={(event) => void submit(event)}>
      <datalist id={list}>
        {usedFootprints(rows).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <table>
        <thead>
          <tr>
            <th scope="col">Designator</th>
            <th scope="col">Kind</th>
            <th scope="col">Value</th>
            <th scope="col">Footprint</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>{row.kind}</td>
              <td>{row.value}</td>
              <td>
                <div style={FIELD_WITH_BUTTON}>
                  <input
                    aria-label={`Footprint of ${row.name}`}
                    list={list}
                    value={changes[row.name] ?? row.footprint}
                    disabled={row.fixed !== undefined}
                    title={row.fixed}
                    onChange={(event) => setChanges((current) => ({ ...current, [row.name]: event.target.value }))}
                  />
                  <button
                    type="button"
                    aria-label={`Choose a package for ${row.name}`}
                    title="Choose from the standard packages"
                    disabled={row.fixed !== undefined}
                    onClick={() =>
                      packagesRequests.open({
                        purpose: { kind: "manager", part: row.name },
                        kind: row.kind,
                        initial: changes[row.name] ?? row.footprint,
                        choose: (footprint) => setChanges((current) => managerChange(current, row.name, footprint)),
                      })
                    }
                  >
                    …
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p role={problem ? "alert" : undefined}>{problem ?? "Changed footprints are written to the circuit file as one change; Undo takes them all back."}</p>
      <button type="submit">Save</button>
    </form>
  )
}
