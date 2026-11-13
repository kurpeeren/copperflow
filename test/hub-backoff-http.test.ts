import { afterEach, expect, test } from "vitest"
import { ManagedRunner } from "../src/hub/runner/runner.js"
import type { HubServer } from "../src/hub/server.js"
import { newUser, startTestHub } from "./helpers/hub-client.js"

let server: HubServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

test("a project origin whose workspace keeps failing answers 503 with Retry-After and launches nothing during the wait", async () => {
  let launches = 0
  server = await startTestHub({
    runner: () =>
      new ManagedRunner({
        launch: async () => {
          launches += 1
          throw new Error("boom")
        },
        log: () => undefined,
      }),
  })
  const ada = await newUser(server, "ada@example.com")
  await ada.submit("/projects", "/projects", { name: "Amp" })
  const id = server.hub.store.projects(server.hub.store.userByEmail("ada@example.com")?.id as string)[0]?.id as string
  await ada.openProject(id)
  const first = await ada.onProject(id, "GET", "/api/circuits")
  expect(first.status).toBe(503)
  expect(first.headers["retry-after"]).toBe("60")
  expect(launches).toBe(1)
  const second = await ada.onProject(id, "GET", "/api/circuits")
  expect(second.status).toBe(503)
  expect(Number(second.headers["retry-after"])).toBeGreaterThan(0)
  expect(Number(second.headers["retry-after"])).toBeLessThanOrEqual(2)
  expect(launches).toBe(1)
})
