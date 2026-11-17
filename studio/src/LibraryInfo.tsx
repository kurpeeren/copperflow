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

  if (!details) return <p className="note">Loading…</p>
  const { part } = details
  const checklist = details.checklist.split("\n").filter((line) => line.startsWith("- ["))
  return (
    <>
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
        <>
          <p className="note ok">Verified by {part.verified?.by} against {part.verified?.against}.</p>
          <button type="button" onClick={() => actions.openVerify(id, part.title)} aria-label={`Look again at ${part.title}`}>
            Look again
          </button>
        </>
      ) : (
        <>
          <p className="note warn">Not verified: {checklist.length} item{checklist.length === 1 ? "" : "s"} in parts/{id}/verification.md to check against the datasheet.</p>
          <button type="button" className="primary" onClick={() => actions.openVerify(id, part.title)} aria-label={`Verify ${part.title}`}>
            Verify…
          </button>
        </>
      )}
    </>
  )
}
