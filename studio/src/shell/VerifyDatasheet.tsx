import { useEffect, useState } from "react"
import { datasheetLink, framedAt, NO_DATASHEET, type DatasheetRecord } from "./verify-datasheet"

interface Props {
  id: string
  datasheet: DatasheetRecord | undefined
  pages: string | undefined
  /** Fetches the part's own PDF from the Studio and gives an address a frame can show; never a remote address. */
  frame(id: string, file: string): Promise<string>
  release(address: string): void
}

/** The part's local PDF in a frame at the first page named, fetched from the Studio with the session's key. */
function LocalPdf({ id, file, pages, frame, release }: { id: string; file: string; pages: string | undefined; frame: Props["frame"]; release: Props["release"] }) {
  const [address, setAddress] = useState<string>()
  const [problem, setProblem] = useState<string>()
  useEffect(() => {
    let shown: string | undefined
    let live = true
    frame(id, file).then(
      (made) => {
        if (live) setAddress((shown = made))
        else release(made)
      },
      (error: Error) => live && setProblem(error.message),
    )
    return () => {
      live = false
      if (shown !== undefined) release(shown)
    }
  }, [id, file, frame, release])
  if (problem) return <p className="note error" role="alert">{problem}</p>
  if (!address) return <p className="note">Loading {file}…</p>
  return <iframe className="verify-pdf" title={`Datasheet ${file}`} src={framedAt(address, pages)} />
}

/** The datasheet record as part.yaml has it, the link at its page, and the local PDF beside the checklist. */
export function VerifyDatasheet({ id, datasheet, pages, frame, release }: Props) {
  if (!datasheet || (datasheet.url === undefined && datasheet.file === undefined)) {
    return (
      <section className="verify-column" aria-label="Datasheet">
        <h3>Datasheet</h3>
        <p className="note warn">{NO_DATASHEET}</p>
      </section>
    )
  }
  return (
    <section className="verify-column" aria-label="Datasheet">
      <h3>Datasheet</h3>
      <dl className="facts">
        {datasheet.title && (
          <>
            <dt>Title</dt>
            <dd>{datasheet.title}</dd>
          </>
        )}
        {datasheet.url && (
          <>
            <dt>Link</dt>
            <dd className="verify-url">{datasheet.url}</dd>
          </>
        )}
        {datasheet.file && (
          <>
            <dt>File</dt>
            <dd>
              <code>{datasheet.file}</code>
            </dd>
          </>
        )}
        <dt>Pages</dt>
        <dd>{pages ?? "not recorded"}</dd>
      </dl>
      {datasheet.url && (
        <a className="verify-open" href={datasheetLink(datasheet.url, pages)} target="_blank" rel="noreferrer noopener">
          Open the datasheet
        </a>
      )}
      {datasheet.file && <LocalPdf id={id} file={datasheet.file} pages={pages} frame={frame} release={release} />}
    </section>
  )
}
