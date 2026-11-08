import { Fragment } from "react"
import { TOOL_ICONS } from "../icons"
import { blurButton } from "../pcb/CanvasTools"
import type { View } from "../pcb/positions"
import type { CommandId } from "./menus"
import { isToolCommand, toolbarGroups } from "./toolbar"
import { clickAction, useToolState } from "./tool-state"
import { VIEW_SLOT_ID } from "./ViewTools"
import "./toolbar.css"

interface Props {
  view: View
  /** The function the menu bar runs its items with. */
  run(command: CommandId): void
}

/** EasyEDA's toolbar: 24px icon buttons in groups, and at the right the open canvas's own tools. */
export function Toolbar({ view, run }: Props) {
  const tools = useToolState()
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      {toolbarGroups(view).map((group, i) => (
        <Fragment key={group[0]?.group}>
          {i > 0 && <span className="toolbar-separator" role="separator" aria-orientation="vertical" />}
          {group.map((item) => {
            const Icon = TOOL_ICONS[item.icon]
            const pressed = tools.active === item.command
            return (
              <button
                key={item.id}
                className="toolbar-button"
                title={item.title}
                aria-label={item.title}
                aria-pressed={isToolCommand(item.command) ? pressed : undefined}
                data-pressed={pressed || undefined}
                onClick={(event) => {
                  blurButton(event)
                  if (clickAction(item.command, tools) === "stop") tools.stop?.()
                  else run(item.command)
                }}
              >
                <Icon />
              </button>
            )
          })}
        </Fragment>
      ))}
      <div className="toolbar-view-slot" id={VIEW_SLOT_ID} />
    </div>
  )
}
