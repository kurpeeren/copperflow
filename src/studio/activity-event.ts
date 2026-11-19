// What the agent is doing, as its MCP process tells a running Studio (POST /api/activity) and the Studio tells every
// open viewer (the "activity" event). One shape on both sides, so the browser strip reads what the MCP process wrote.
import { z } from "zod"

/** The longest message kept: a strip line, not a report. */
export const MAX_ACTIVITY_MESSAGE = 300

export const AgentActivitySchema = z
  .object({
    tool: z.string().min(1).max(64),
    message: z.string().max(MAX_ACTIVITY_MESSAGE),
    progress: z.number().finite().min(0).optional(),
    total: z.number().finite().positive().optional(),
    state: z.enum(["running", "done", "failed"]),
  })
  .strict()

/** One step of a tool call: it started or moved on ("running"), or it ended ("done" or "failed"). */
export type AgentActivity = z.infer<typeof AgentActivitySchema>
