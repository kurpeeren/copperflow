import { describe, expect, it } from "vitest"
import { showProjects } from "../studio/src/shell/projects-command.js"

describe("File → Projects…", () => {
  it("goes back to the start screen through the desktop app", async () => {
    let asked = 0
    const notes: string[] = []
    await showProjects({ backToProjects: async () => void asked++ }, (note) => notes.push(note))
    expect(asked).toBe(1)
    expect(notes).toEqual([])
  })

  it("says why when the desktop app could not show the projects, leaving no rejected promise", async () => {
    const notes: string[] = []
    await showProjects({ backToProjects: async () => Promise.reject(new Error("the window is closing")) }, (note) => notes.push(note))
    expect(notes).toEqual(["The projects could not be shown: the window is closing"])
  })

  it("does nothing outside the desktop app", async () => {
    const notes: string[] = []
    await showProjects(undefined, (note) => notes.push(note))
    expect(notes).toEqual([])
  })
})
