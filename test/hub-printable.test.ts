import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { runCli, type CliIO } from "../src/cli-commands.js"
import { STATUS_FILE } from "../src/hub/commands.js"
import { isUnsafeCodePoint, printable, removalFailure } from "../src/hub/printable.js"
import { HubStore } from "../src/hub/store.js"
import { prepareDataDir } from "../src/hub/permissions.js"

const ch = (...codes: number[]) => String.fromCodePoint(...codes)
/** An escape sequence that clears the screen, a title change, CR LF, a C1 CSI, a right-to-left override and an isolate. */
const HOSTILE = `evil${ch(0x1b)}[2J${ch(0x1b)}]0;pwned${ch(0x07)}${ch(0x0d, 0x0a)}next${ch(0x9b)}31m${ch(0x202e)}RTL${ch(0x2066)}x${ch(0x2028)}`
const clean = (text: string | undefined) => [...(text ?? "")].every((char) => !isUnsafeCodePoint(char.codePointAt(0) ?? 0))

describe("person- and container-controlled text never reaches the maintainer unsanitised", () => {
  test("printable replaces control, C1, bidirectional and line-break characters and caps the length", () => {
    expect(clean(HOSTILE)).toBe(false)
    expect(clean(printable(HOSTILE))).toBe(true)
    expect(printable("x".repeat(500), 20)).toHaveLength(20)
    expect(printable("plain name")).toBe("plain name")
    expect(removalFailure(`the cleaning container failed: ${HOSTILE}`)).toBe("engine-error")
    expect(removalFailure("ls did not finish within 120000 ms")).toBe("timeout")
    expect(removalFailure("EACCES: permission denied")).toBe("permission")
    expect(removalFailure("the folder is still there after both removals")).toBe("not-empty")
    expect(removalFailure(HOSTILE)).toBe("unknown")
  })

  test("a hostile reason in the status file and a hostile name in the audit log come out harmless", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-print-"))
    const store = HubStore.open(await prepareDataDir(data))
    store.audit({ time: 1, userId: null, event: `project-renamed${HOSTILE}`, address: "cli", detail: `a project called ${HOSTILE}` })
    const [row] = store.auditLog(1)
    store.close()
    expect(clean(row?.event)).toBe(true)
    expect(clean(row?.detail)).toBe(true)
    await writeFile(join(data, STATUS_FILE), JSON.stringify({ updated: Date.now(), pid: 1, running: 0, runner: HOSTILE, trashFailures: [{ name: HOSTILE, failures: 4, reason: HOSTILE }] }))
    const lines: string[] = []
    const io: CliIO = { out: (text) => lines.push(text), err: (text) => lines.push(text) }
    expect(await runCli(["hub", "status", "--data", data], "/", io)).toBe(0)
    expect(lines.some((line) => line.includes("failed attempts"))).toBe(true)
    for (const line of lines) expect(clean(line)).toBe(true)
  })

  test("every io.out, io.err and error in the hub's commands wraps a stored string in printable", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/hub/commands.ts", import.meta.url)), "utf8")
    const stored = /\b(user\.email|answer|warning|line|runner|running|measured\.failed|entry\.\w+|email|name|reason|stderr)\b/
    const offenders: string[] = []
    source.split("\n").forEach((text, index) => {
      if (!/io\.(out|err)\(|throw new Error\(|=> `/.test(text)) return
      for (const match of text.matchAll(/\$\{([^${}]+)\}/g)) {
        const inner = (match[1] as string).trim()
        if (stored.test(inner) && !inner.startsWith("printable(")) offenders.push(`commands.ts:${index + 1}: ${inner}`)
      }
    })
    expect(offenders).toEqual([])
  })
})
