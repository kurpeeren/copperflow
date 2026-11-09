import { Fragment } from "react"
import { TOOL_ICONS } from "../icons"
import { blurAfterPointerClick } from "./focus"
import type { View } from "../pcb/positions"
import type { Unit } from "../pcb/units"
import type { CommandId } from "./menus"
import { isToolCommand, toolbarGroups, type ToolbarButton } from "./toolbar"
import { clickAction, useToolState } from "./tool-state"
import { VIEW_SLOT_ID } from "./ViewTools"
import "./toolbar.css"

interface Props {
  view: View
  /** The PCB's unit, which the Unit button shows. */
  unit: Unit
  /** The function the menu bar runs its items with. */
  run(command: CommandId): void
}

function ButtonFace({ item, unit }: { item: ToolbarButton; unit: Unit }) {
  if (item.text === "unit") return <>{unit}</>
  const Icon = TOOL_ICONS[item.icon]
  return <Icon />
}

/** EasyEDA's toolbar: 24px icon buttons in groups, and at the right the open canvas's own tools. */
export function Toolbar({ view, unit, run }: Props) {
  const tools = useToolState()
  return (
    <div className="studio-toolbar" role="toolbar" aria-label="Tools">
      {toolbarGroups(view).map((group, i) => (
        <Fragment key={group[0]?.group}>
          {i > 0 && <span className="toolbar-separator" role="separator" aria-orientation="vertical" />}
          {group.map((item) => {
            const pressed = tools.active === item.command
            return (
              <button
                key={item.id}
                className={item.text ? "toolbar-button text" : "toolbar-button"}
                title={item.title}
                aria-label={item.text === "unit" ? `${item.title}, now ${unit}` : item.title}
                aria-pressed={isToolCommand(item.command) ? pressed : undefined}
                data-pressed={pressed || undefined}
                onClick={(event) => {
                  blurAfterPointerClick(event)
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
