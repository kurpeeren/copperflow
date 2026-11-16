import { Fragment } from "react"
import { TOOL_ICONS } from "../icons"
import { blurAfterPointerClick } from "./focus"
import type { View } from "../pcb/positions"
import type { Unit } from "../pcb/units"
import type { CommandId, CommandsOff, Toggles } from "./menus"
import { buttonPressed, buttonState, hasPressedState, toolbarGroups, type ToolbarButton } from "./toolbar"
import { clickAction, useToolState } from "./tool-state"
import { VIEW_SLOT_ID } from "./ViewTools"
import "./toolbar.css"

interface Props {
  view: View
  /** The PCB's unit, which the Unit button shows. */
  unit: Unit
  /** How many parts are selected, for the buttons that need two or three. */
  selected: number
  /** The settings the switch buttons show: pressed while on. */
  toggles: Toggles
  /** Commands turned off for now, with the reason each button's tooltip gives. */
  off?: CommandsOff
  /** The function the menu bar runs its items with. */
  run(command: CommandId): void
}

function ButtonFace({ item, unit }: { item: ToolbarButton; unit: Unit }) {
  if (item.text === "unit") return <>{unit}</>
  const Icon = TOOL_ICONS[item.icon]
  return <Icon />
}

/** EasyEDA's toolbar: 24px icon buttons in groups, and at the right the open canvas's own tools. */
export function Toolbar({ view, unit, selected, toggles, off, run }: Props) {
  const tools = useToolState()
  return (
    <div className="studio-toolbar hairline-b" role="toolbar" aria-label="Tools">
      {toolbarGroups(view).map((group, i) => (
        <Fragment key={group[0]?.group}>
          {i > 0 && <span className="toolbar-separator" role="separator" aria-orientation="vertical" />}
          {group.map((item) => {
            const pressed = item.command !== undefined && buttonPressed(item.command, tools.active, toggles)
            const state = buttonState(item, selected, off)
            return (
              <button
                key={item.id}
                className={item.text ? "toolbar-button text" : "toolbar-button"}
                title={state.title}
                aria-label={item.text === "unit" ? `${item.title}, now ${unit}` : state.title}
                aria-disabled={state.enabled ? undefined : true}
                aria-pressed={item.command !== undefined && hasPressedState(item.command) ? pressed : undefined}
                data-pressed={pressed || undefined}
                onClick={(event) => {
                  blurAfterPointerClick(event)
                  if (!state.enabled || item.command === undefined) return
                  if (clickAction(item.command, tools) === "stop") tools.stop?.()
                  else run(item.command)
                }}
              >
                <ButtonFace item={item} unit={unit} />
              </button>
            )
          })}
        </Fragment>
      ))}
      <div className="toolbar-view-slot" id={VIEW_SLOT_ID} />
    </div>
  )
}
