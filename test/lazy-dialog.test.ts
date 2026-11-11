// A dialog loaded on first open: a failed load shows a message with Retry inside the dialog, and Retry imports again.
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"
import { DialogBoundary, DialogLoadFailed, lazyRetrying, retryingLoader } from "../studio/src/shell/lazy-dialog.js"

describe("loading a dialog on demand", () => {
  test("a failed load is not kept: the next call imports again, and a success is kept", async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module")).mockResolvedValue("form")
    const loader = retryingLoader(load)
    await expect(loader()).rejects.toThrow("Failed to fetch")
    await expect(loader()).resolves.toBe("form")
    await expect(loader()).resolves.toBe("form")
    expect(load).toHaveBeenCalledTimes(2)
  })

  test("retry makes a new lazy component, so React does not reuse the failed one", () => {
    const dialog = lazyRetrying(() => Promise.resolve(() => null))
    const first = dialog.component()
    expect(dialog.component()).toBe(first)
    dialog.retry()
    expect(dialog.component()).not.toBe(first)
  })

  test("the boundary catches the failure and shows it in the dialog with Retry", () => {
    expect(DialogBoundary.getDerivedStateFromError(new Error("offline"))).toEqual({ error: expect.objectContaining({ message: "offline" }) })
    const html = renderToStaticMarkup(createElement(DialogLoadFailed, { what: "New part", message: "Failed to fetch", onRetry: () => undefined }))
    expect(html).toContain('role="alert"')
    expect(html).toContain("The New part dialog could not open (Failed to fetch).")
    expect(html).toContain(">Retry</button>")
  })

  test("while nothing failed, the boundary renders the dialog", () => {
    const html = renderToStaticMarkup(createElement(DialogBoundary, { what: "New part", onRetry: () => undefined, render: () => createElement("p", null, "the form") }))
    expect(html).toBe("<p>the form</p>")
  })
})
