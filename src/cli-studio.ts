// `copperflow studio [--port n] [--idle-minutes n]` and `copperflow studio stop`.
import { runStudio } from "./studio/run-studio.js"
import { stopStudio } from "./studio/studio-note.js"

const END_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const

export async function studioCommand(
  root: string,
  rest: string[],
  takeOption: (args: string[], name: string) => [string | undefined, string[]],
): Promise<string> {
  if (rest[0] === "stop") return stopStudio(root)
  const [port, afterPort] = takeOption(rest, "--port")
  const [idle] = takeOption(afterPort, "--idle-minutes")
  const running = await runStudio({
    root,
    ...(port !== undefined ? { port: wholeNumber(port, "--port") } : {}),
    ...(idle !== undefined ? { idleMinutes: wholeNumber(idle, "--idle-minutes") } : {}),
  })
  // Ctrl+C, SIGTERM, a closed terminal and the idle stop all close the Studio and remove its note.
  for (const signal of END_SIGNALS) process.once(signal, () => void running.stop())
  void running.stopped.then(() => process.exit(0))
  return `copperflow studio is running. Open this address (it contains a key for this session):\n${running.studio.openUrl}\nPress Ctrl+C to stop.`
}

function wholeNumber(text: string, option: string): number {
  const value = Number(text)
  if (!Number.isInteger(value) || value < 1) throw new Error(`${option} must be a positive whole number (got "${text}")`)
  return value
}
