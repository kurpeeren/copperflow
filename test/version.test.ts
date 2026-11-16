import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"
import { VERSION } from "../src/version.js"

test("the program's version is the package's version", () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as { version: string }
  expect(VERSION).toBe(manifest.version)
})
