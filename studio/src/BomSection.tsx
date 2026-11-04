import { useEffect, useState } from "react"
import { api, type BomLine } from "./api"
import type { Actions } from "./App"

interface Props {
  file: string
  /** Changes when a build finishes, which may add supplier part numbers. */
  buildId: string | undefined
  actions: Actions
}

/** The bill of materials of the open circuit, and the datasheet package export. */
export function BomSection({ file, buildId, actions }: Props) {
  const [lines, setLines] = useState<BomLine[]>([])
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    api<BomLine[]>(`/api/bom?file=${encodeURIComponent(file)}`)
      .then(setLines)
      .catch((error: Error) => actions.notify(error.message))
  }, [file, buildId, actions])

  const total = lines.reduce((sum, line) => sum + line.quantity, 0)
  return (
    <>
      <h3>
        Bill of materials <span className="count">{total} parts</span>
      </h3>
      <table className="bom">
        <thead>
          <tr>
            <th scope="col">Parts</th>
            <th scope="col">Value</th>
            <th scope="col">Supplier</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.designators.join(" ")}>
              <td>
                {line.designators.join(", ")}
                {line.libraryPart && !line.verified && <span className="badge unverified">Unverified</span>}
              </td>
              <td title={line.footprint}>{line.value || line.kind}</td>
              <td>
                <code>{line.supplier.replace(/^\w+ /, "")}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        disabled={exporting}
        onClick={() => {
          setExporting(true)
          api<{ outDir: string; files: string[] }>("/api/package", { file })
            .then((result) => actions.notify(`Exported ${result.files.length} files to ${result.outDir}`))
            .catch((error: Error) => actions.notify(error.message))
            .finally(() => setExporting(false))
        }}
      >
        {exporting ? "Exporting" : "Export BOM and datasheets"}
      </button>
    </>
  )
}
