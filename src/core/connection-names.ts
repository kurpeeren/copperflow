// What a sub-sheet instance's connection may name: a net port a net of the parent ("VBUS"), a bus port a bus of the
// parent ("D[0:7]"); a net local to an instance ("net.PS1/FB") never. Pure, so the Studio checks with it too.
import { busMembers } from "../engine/drawing-kinds.js"
import { localNet, localNetRefusal } from "../engine/selectors.js"

const NET_NAME = /^[A-Za-z_][\w-]*$/

/** Why `target` cannot be what port `port` of `sheet` connects to, or undefined when it can. */
export function connectionRefusal(sheet: string, port: string, target: string, bus: boolean): string | undefined {
  const local = localNet(target)
  if (local) return localNetRefusal(local, undefined)
  const name = target.replace(/^net\./, "")
  if (bus) return busMembers(name) === undefined ? `${sheet} port ${port} is a bus port and takes a bus name such as "D[0:7]", not "${target}"` : undefined
  return NET_NAME.test(name) ? undefined : `${sheet} port ${port} is a net port and takes a net name such as "VBUS", not "${target}"`
}
