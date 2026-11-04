import { useEffect, useState } from "react"
import { api, type PartDetails } from "./api"
import type { Actions } from "./App"

interface Props {
  id: string
  verified: boolean
  actions: Actions
}

/** A placed library part: where its data comes from, its datasheet and its verification. */
export function LibraryInfo({ id, verified, actions }: Props) {
  const [details, setDetails] = useState<PartDetails>()
  useEffect(() => {
    api<PartDetails>(`/api/part?id=${encodeURIComponent(id)}`)
      .then(setDetails)
      .catch((error: Error) => actions.notify(error.message))
  }, [id, verified, actions])

  if (!details) return null
  const { part } = details
  const checklist = details.checklist.split("\n").filter((line) => line.startsWith("- ["))
  return (
    <>
      <h3>Library part</h3>
      <dl className="facts">
        <dt>Part</dt>
        <dd>{part.title}</dd>
        {part.manufacturer && (
          <>
            <dt>Maker</dt>
            <dd>{part.manufacturer}</dd>
          </>
        )}
        {part.mpn && (
          <>
            <dt>MPN</dt>
            <dd>
              <code>{part.mpn}</code>
            </dd>
          </>
        )}
        <dt>Footprint</dt>
        <dd>
          <code>{part.footprint}</code>
        </dd>
        {Object.entries(part.suppliers ?? {}).map(([supplier, number]) => (
          <span key={supplier} className="contents">
            <dt>{supplier}</dt>
            <dd>
              <code>{number}</code>
            </dd>
          </span>
        ))}
        {part.datasheet?.url && (
          <>
            <dt>Datasheet</dt>
            <dd>
              <a href={part.datasheet.url} target="_blank" rel="noreferrer noopener">
                Open
              </a>
            </dd>
          </>
        )}
      </dl>
      <p className="hint">These come from parts/{id}/part.yaml and are the same for every copy of the part.</p>

      {verified ? (
        <p className="note ok">Verified by {part.verified?.by} against {part.verified?.against}.</p>
      ) : (
        <VerifyForm id={id} checklist={checklist} actions={actions} />
      )}
    </>
  )
}

function VerifyForm({ id, checklist, actions }: { id: string; checklist: string[]; actions: Actions }) {
  const [by, setBy] = useState("")
  const [against, setAgainst] = useState("")
  const [confirm, setConfirm] = useState("")
  return (
    <form
      className="verify"
      onSubmit={(e) => {
        e.preventDefault()
        void actions.verify(id, by.trim(), against.trim(), confirm)
      }}
    >
      <p className="note warn">Not verified. Check each item against the datasheet:</p>
      <ul className="checklist">
        {checklist.map((item) => (
          <li key={item}>{item.replace(/^- \[ \] /, "")}</li>
        ))}
      </ul>
      <label>
        Checked against
        <input value={against} onChange={(e) => setAgainst(e.target.value)} placeholder="Datasheet, revision, page" required />
      </label>
      <label>
        Your name
        <input aria-label="Your name" value={by} onChange={(e) => setBy(e.target.value)} required />
      </label>
      <label>
        Type {id} to confirm
        <input aria-label={`Type ${id} to confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} spellCheck={false} required />
      </label>
      <button type="submit" className="primary" disabled={confirm.trim() !== id || !by.trim() || !against.trim()}>
        Mark verified
      </button>
    </form>
  )
}
