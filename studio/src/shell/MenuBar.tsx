import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react"
import { blurButton, isPointerClick } from "./focus"
import { useKeyHold } from "./key-gate"
import { firstMenuItem, menuKey, type MenuFocus, type MenuKeyResult } from "./menu-keys"
import { MENUS, MENU_SHAPES, menuReducer, type CommandId, type Menu, type MenuEntry } from "./menus"
import "./shell.css"

interface Props {
  run(command: CommandId): void
  /** The build status, at the right end of the bar. */
  children?: ReactNode
}

/** Runs an item's command; `keyboard` when it was Enter or Space, which brings the focus back to the menu's title. */
type OnRun = (command: CommandId, menu: number, keyboard: boolean) => void

const selectorOf = (focus: MenuFocus) => (focus.item === null ? `[data-menu="${focus.menu}"]:not([data-item])` : `[data-menu="${focus.menu}"][data-item="${focus.item}"]`)

/** Where the focus is in the bar, from the focused element's data attributes; null outside the bar. */
function focusOf(bar: HTMLElement | null, element: Element | null): MenuFocus | null {
  const node = element instanceof HTMLElement && bar?.contains(element) ? element.closest<HTMLElement>("[data-menu]") : null
  if (!node) return null
  const item = node.dataset.item
  return { menu: Number(node.dataset.menu), item: item === undefined ? null : Number(item) }
}

/** Moves the focus to a title or an item: at once when it is on screen, else once the menu holding it has rendered. */
function useFocusMover(bar: RefObject<HTMLElement | null>): (target: MenuFocus) => void {
  const pending = useRef<MenuFocus | null>(null)
  useLayoutEffect(() => {
    const target = pending.current
    if (!target) return
    pending.current = null
    bar.current?.querySelector<HTMLElement>(selectorOf(target))?.focus()
  })
  return useCallback(
    (target: MenuFocus) => {
      const element = bar.current?.querySelector<HTMLElement>(selectorOf(target))
      if (element) element.focus()
      else pending.current = target
    },
    [bar],
  )
}

/** Closes the open menu on a press outside the bar. */
function useCloseOnOutsidePress(open: boolean, bar: RefObject<HTMLElement | null>, close: () => void): void {
  useEffect(() => {
    if (!open) return
    const onPress = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !bar.current?.contains(event.target)) close()
    }
    window.addEventListener("pointerdown", onPress, true)
    return () => window.removeEventListener("pointerdown", onPress, true)
  }, [open, bar, close])
}

function Entry({ entry, menu, index, onRun }: { entry: MenuEntry; menu: number; index: number; onRun: OnRun }) {
  if (entry === "separator") return <li className="menu-separator" role="separator" />
  const { label, shortcut, command, pending } = entry
  return (
    <li role="none">
      <button
        role="menuitem"
        className="menu-item"
        data-menu={menu}
        data-item={index}
        tabIndex={-1}
        aria-disabled={command ? undefined : true}
        title={pending}
        onClick={(event) => {
          const keyboard = !isPointerClick(event)
          if (!keyboard) blurButton(event)
          if (command) onRun(command, menu, keyboard)
        }}
      >
        <span>{label}</span>
        {shortcut && <kbd>{shortcut}</kbd>}
      </button>
    </li>
  )
}

function Dropdown({ menu, index, onRun }: { menu: Menu; index: number; onRun: OnRun }) {
  return (
    <ul className="menu-dropdown" role="menu" aria-label={menu.title}>
      {menu.entries.map((entry, i) => (
        <Entry key={entry === "separator" ? `sep${i}` : entry.label} entry={entry} menu={index} index={i} onRun={onRun} />
      ))}
    </ul>
  )
}

interface TitleProps {
  menu: Menu
  index: number
  open: boolean
  /** Whether this title holds the bar's one tab stop. */
  current: boolean
  /** A pointer click: opens the menu or closes it; the focus is given up, so Space still rotates the part. */
  onPointer(index: number): void
  onHover(index: number): void
  /** Enter or Space: opens the menu with the focus on its first item. */
  onKeyboard(next: MenuKeyResult): void
  onRun: OnRun
}

function MenuTitle({ menu, index, open, current, onPointer, onHover, onKeyboard, onRun }: TitleProps) {
  return (
    <div className="menu">
      <button
        role="menuitem"
        data-menu={index}
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={current ? 0 : -1}
        className={`menu-title${open ? " open" : ""}`}
        onClick={(event) => {
          if (!isPointerClick(event)) return onKeyboard({ open: index, focus: { menu: index, item: firstMenuItem(MENU_SHAPES[index]) }, preventDefault: true })
          blurButton(event)
          onPointer(index)
        }}
        onPointerEnter={() => onHover(index)}
      >
        {menu.title}
      </button>
      {open && <Dropdown menu={menu} index={index} onRun={onRun} />}
    </div>
  )
}

/** EasyEDA's menu bar: brand, File … Help, and Studio's build status at the right end. The keys are menu-keys.ts. */
export function MenuBar({ run, children }: Props) {
  const [state, dispatch] = useReducer(menuReducer, { open: null })
  const [current, setCurrent] = useState(0)
  const bar = useRef<HTMLElement>(null)
  const moveFocus = useFocusMover(bar)
  const open = state.open === null ? null : MENUS.findIndex((m) => m.title === state.open)
  const apply = (next: MenuKeyResult) => {
    dispatch({ type: "set", title: next.open === null ? null : (MENUS[next.open]?.title ?? null) })
    if (next.focus === "keep") return
    setCurrent(next.focus.menu)
    moveFocus(next.focus)
  }
  const onKey = (event: KeyboardEvent | ReactKeyboardEvent): boolean => {
    const next = menuKey(event.key, focusOf(bar.current, document.activeElement), open, MENU_SHAPES)
    if (!next) return false
    if (next.preventDefault) event.preventDefault()
    apply(next)
    return true
  }
  // While a menu is open it holds every key, so none reaches the canvas or the panels behind it.
  useKeyHold(open !== null, (event) => void onKey(event))
  useCloseOnOutsidePress(open !== null, bar, useCallback(() => dispatch({ type: "outside" }), []))
  const onRun: OnRun = (command, menu, keyboard) => {
    if (keyboard) apply({ open: null, focus: { menu, item: null }, preventDefault: true })
    dispatch({ type: "run" })
    run(command)
  }
  const onPointer = (index: number) => {
    setCurrent(index)
    dispatch({ type: "click", title: MENUS[index]?.title ?? "" })
  }
  const onHover = (index: number) => dispatch({ type: "hover", title: MENUS[index]?.title ?? "" })
  return (
    <header className="menubar" ref={bar}>
      <span className="brand" title="copperflow">
        copperflow
      </span>
      <nav className="menus" role="menubar" aria-label="Menu" onKeyDown={(event) => onKey(event) && event.stopPropagation()}>
        {MENUS.map((menu, i) => (
          <MenuTitle key={menu.title} menu={menu} index={i} open={open === i} current={current === i} onPointer={onPointer} onHover={onHover} onKeyboard={apply} onRun={onRun} />
        ))}
      </nav>
      <div className="menubar-end">{children}</div>
    </header>
  )
}
