#!/usr/bin/env node
import { runCli } from "./cli-commands.js"

runCli(process.argv.slice(2), process.cwd(), {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
}).then((code) => {
  process.exitCode = code
})
