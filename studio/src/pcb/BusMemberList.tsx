// The small list of a bus's members the W tool opens where a wire meets a bus: the arrows move, Enter or a click picks
// the member, Esc or moving the focus away closes it; it opens inside the canvas (bus-pick.ts). The wire is written to the member picked (use-wire-tool.ts).
import { useEffect, useRef, useState } from "react"
import "./bus-members.css"
import { listPlace, memberKey } from "./bus-pick"
import { worldToScreen, type Camera, type Size } from "./geometry"
import type { useWireTool } from "./use-wire-tool"

type WireTool = ReturnType<typeof useWireTool>

export function BusMemberList({ wire, camera, size }: { wire: WireTool; camera: Camera | undefined; size: Size }) {
  const { picking } = wire
  if (!picking || !camera) return null
  const members = picking.bus.members ?? []
  const { left, top } = listPlace(worldToScreen(camera, size, picking.bus.at), size, members.length)
  const key = `${picking.bus.selector}:${picking.bus.at.x}:${picking.bus.at.y}`
  return <MemberList key={key} left={left} top={top} name={picking.bus.label} members={members} wire={wire} />
}

interface ListProps {
  left: number
  top: number
  name: string
  members: readonly string[]
  wire: WireTool
}

function MemberList({ left, top, name, members, wire }: ListProps) {
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  // Take the keys once the press that opened the list is over, so the canvas does not keep them.
  useEffect(() => {
    const frame = requestAnimationFrame(() => list.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  useEffect(() => list.current?.children[index]?.scrollIntoView({ block: "nearest" }), [index])
  return (
    <ul
      ref={list}
      className="bus-members"
      role="listbox"
      aria-label={`Members of ${name}`}
      aria-activedescendant={`bus-member-${index}`}
      tabIndex={0}
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) wire.cancelPick()
      }}
      onKeyDown={(e) => {
        const action = memberKey(index, members.length, e.key)
        if (!action) return
        e.preventDefault()
        e.stopPropagation()
        if ("index" in action) return setIndex(action.index)
        if ("cancel" in action) return wire.cancelPick()
        const member = members[action.pick]
        if (member !== undefined) wire.pick(member)
      }}
    >
      {members.map((member, i) => (
        <li key={member} id={`bus-member-${i}`} role="option" aria-selected={i === index} onPointerEnter={() => setIndex(i)} onClick={() => wire.pick(member)}>
          {member}
        </li>
      ))}
    </ul>
  )
}
