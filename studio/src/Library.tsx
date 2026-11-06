import { useEffect, useRef, useState } from "react"
import type { PartsData } from "./api"

interface Props {
  parts: PartsData
  onPlace(part: string): void
  /** Focus the search field now (Shift+F); `onFocused` says it has been done. */
  focus: boolean
  onFocused(): void
}

/** Parts that can be added to the board: the project's library and the built-in parts. */
export function Library({ parts, onPlace, focus, onFocused }: Props) {
  const [query, setQuery] = useState("")
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!focus) return
    search.current?.focus()
    onFocused()
  }, [focus, onFocused])
  const needle = query.trim().toLowerCase()
  const matches = (...texts: (string | undefined)[]) => needle === "" || texts.some((t) => t?.toLowerCase().includes(needle))
  const library = parts.library.filter((p) => matches(p.id, p.title, p.mpn, p.footprint))
  const builtin = parts.builtin.filter((name) => matches(name))

  return (
    <div className="library">
      <input
        ref={search}
        className="search"
        type="search"
        placeholder="Search parts"
        aria-label="Search parts"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <h3>
        Project library <span className="count">{parts.library.length}</span>
      </h3>
      {parts.library.length === 0 && (
        <p className="note">No parts yet. Ask the agent to create one from a datasheet.</p>
      )}
      <ul>
        {library.map((part) => (
          <li key={part.id} className="library-item">
            <div className="text">
              <span className="title">{part.title}</span>
              <span className="meta">
                {part.mpn ?? part.id}, {part.footprint}
              </span>
            </div>
            <span className={`badge ${part.verified ? "verified" : "unverified"}`} title={part.verified ? `Checked by ${part.verifiedBy}` : "Not checked against the datasheet yet"}>
              {part.verified ? "Verified" : "Unverified"}
            </span>
            <button onClick={() => onPlace(part.id)} aria-label={`Place ${part.title}`}>
              Place
            </button>
          </li>
        ))}
      </ul>

      <h3>Built-in parts</h3>
      <ul className="builtin">
        {builtin.map((name) => (
          <li key={name}>
            <button className="chip-button" onClick={() => onPlace(name)} aria-label={`Place a ${name}`}>
              {name}
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">Placed parts start at the board centre; drag them into position on the PCB.</p>
    </div>
  )
}
