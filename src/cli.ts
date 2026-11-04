#!/usr/bin/env node
import { createInterface } from "node:readline/promises"
import { runCli } from "./cli-commands.js"

const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true

runCli(process.argv.slice(2), process.cwd(), {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  ...(interactive
    ? {
        ask: async (question: string) => {
          const prompt = createInterface({ input: process.stdin, output: process.stdout })
          try {
            return await prompt.question(question)
          } finally {
            prompt.close()
          }
        },
      }
    : {}),
}).then((code) => {
  process.exitCode = code
})
