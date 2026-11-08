import { useEffect, useReducer, useRef, type ReactNode } from "react"
import { MENUS, menuReducer, type CommandId, type Menu, type MenuEntry } from "./menus"
import { blurButton } from "../pcb/CanvasTools"
import "./shell.css"

interface Props {
  run(command: CommandId): void
  /** The file selector, build status and Undo, at the right end. */
  children?: ReactNode
}

/** Closes the open menu on Esc and on a press outside the bar. */
function useCloseOutside(open: boolean, bar: React.RefObject<HTMLElement | null>, close: (type: "escape" | "outside") => void): void {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      close("escape")
    }
    const onPress = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !bar.current?.contains(event.target)) close("outside")
    }
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("pointerdown", onPress, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("pointerdown", onPress, true)
    }
  }, [open, bar, close])
}

function Entry({ entry, onRun }: { entry: MenuEntry; onRun(command: CommandId): void }) {
  if (entry === "separator") return <li className="menu-separator" role="separator" />
  const { label, shortcut, command, pending } = entry
  return (
    <li role="none">
      <button
        role="menuitem"
        className="menu-item"
        aria-disabled={command ? undefined : true}
        title={pending}
        onClick={(event) => {
          blurButton(event)
          if (command) onRun(command)
        }}
      >
        <span>{label}</span>
        {shortcut && <kbd>{shortcut}</kbd>}
      </button>
    </li>
  )
}

function Dropdown({ menu, onRun }: { menu: Menu; onRun(command: CommandId): void }) {
  return (
    <ul className="menu-dropdown" role="menu" aria-label={menu.title}>
      {menu.entries.map((entry, i) => (
        <Entry key={entry === "separator" ? `sep${i}` : entry.label} entry={entry} onRun={onRun} />
      ))}
    </ul>
  )
}

/** EasyEDA's menu bar: brand, File … Help, and Studio's file, build state and Undo at the right. */
export function MenuBar({ run, children }: Props) {
  const [state, dispatch] = useReducer(menuReducer, { open: null })
  const bar = useRef<HTMLElement>(null)
  const close = useRef((type: "escape" | "outside") => dispatch({ type })).current
  useCloseOutside(state.open !== null, bar, close)
  const onRun = (command: CommandId) => {
    dispatch({ type: "run" })
    run(command)
  }
  return (
    <header className="menubar" ref={bar}>
      <span className="brand" title="copperflow">copperflow</span>
      <nav className="menus" role="menubar" aria-label="Menu">
        {MENUS.map((menu) => (
          <div key={menu.title} className="menu">
            <button
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={state.open === menu.title}
              className={`menu-title${state.open === menu.title ? " open" : ""}`}
              onClick={(event) => {
                blurButton(event)
                dispatch({ type: "click", title: menu.title })
              }}
              onPointerEnter={() => dispatch({ type: "hover", title: menu.title })}
            >
              {menu.title}
            </button>
            {state.open === menu.title && <Dropdown menu={menu} onRun={onRun} />}
          </div>
        ))}
      </nav>
      <div className="menubar-end">{children}</div>
    </header>
  )
}
