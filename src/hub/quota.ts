// The disk quota while workspaces run. The quota is checked on create and upload, but a running workspace writes into
// its project folder freely; so every few seconds the hub measures the folders of users with a running workspace
// (through safe-files, never following a link) and stops every running workspace of a user over quota, marking those
// projects. A marked project does not start again until the user is back under quota (they can still download or
// delete projects from the project page). What this does not stop: a workspace can write as fast as the disk allows
// for up to one sweep interval past the quota (docs/hosted.md, "Running the hub").
import type { Hub } from "./context.js"

/** How often running workspaces are measured: 5 s. */
export const QUOTA_SWEEP_MS = 5_000

export const OVER_QUOTA_MESSAGE =
  "This project was stopped because your projects use more disk space than the plan allows. Download or delete projects on the projects page; the project opens again once you are under the limit."

/** Refused because the user is over their disk quota. */
export class OverQuotaError extends Error {
  constructor() {
    super(OVER_QUOTA_MESSAGE)
  }
}

type QuotaHub = Pick<Hub, "runner" | "store" | "files" | "config" | "log">

/** Stops every running workspace of each user over quota and marks its project; the ids it stopped. */
export async function sweepQuota(hub: QuotaHub): Promise<string[]> {
  const byUser = new Map<string, string[]>()
  for (const { id, userId } of hub.runner.active()) byUser.set(userId, [...(byUser.get(userId) ?? []), id])
  const stopped: string[] = []
  for (const [userId, ids] of byUser) {
    const used = await hub.files.usage(userId)
    if (used <= hub.config.maxBytes) continue
    for (const id of ids) {
      hub.store.setOverQuota(id, true)
      await hub.runner.stop(id)
      stopped.push(id)
    }
    hub.store.audit({ time: hub.config.now(), userId, event: "over-quota-stop", address: "hub", detail: `${ids.length} workspace(s), ${used} bytes` })
    hub.log(`user ${userId} is over the disk quota (${used} bytes); stopped ${ids.length} workspace(s)`)
  }
  return stopped
}

/** Before a project's workspace starts: a marked project starts only once its user is back under quota. */
export async function checkQuotaBeforeStart(hub: QuotaHub, userId: string, projectId: string): Promise<void> {
  if (!hub.store.overQuota(projectId)) return
  if ((await hub.files.usage(userId)) > hub.config.maxBytes) throw new OverQuotaError()
  hub.store.setOverQuota(projectId, false)
}
