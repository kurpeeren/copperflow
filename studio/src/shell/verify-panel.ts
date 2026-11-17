// The Verify screen's link to the Studio's routes: load the part, tick verification.md, mark verified, the part's own
// datasheet PDF as a blob for the frame, and the 1:1 print page. Nothing here fetches a remote address.
import { useMemo } from "react"
import type { Footprint } from "../../../src/engine/footprints/types.js"
import { api, apiBlob, type PartDetails } from "../api"
import { printFootprintHtml } from "./verify-print"
import type { VerifyPanel } from "./VerifyPartDialog"

function openPrintPage(html: string): boolean {
  const view = window.open("", "_blank")
  if (!view) return false
  view.document.open()
  view.document.write(html)
  view.document.close()
  view.focus()
  view.setTimeout(() => view.print(), 0)
  return true
}

export function useVerifyPanel(refreshParts: () => Promise<void>): VerifyPanel {
  return useMemo(
    () => ({
      load: (id: string) => api<PartDetails>(`/api/part?id=${encodeURIComponent(id)}`),
      tick: async (id: string, items: readonly string[], ticked: boolean, shown: string) => {
        try {
          return await api<{ checklist: string }>("/api/tick", { id, items, ticked, shown })
        } catch (error) {
          // 409: the file is not the text the page showed; the answer carries the file as it is.
          const refused = error as Error & { status?: number; data?: { checklist?: unknown } }
          if (refused.status === 409 && typeof refused.data?.checklist === "string") return { changed: refused.data.checklist }
          throw error
        }
      },
      mark: async (id: string, form: { by: string; against: string; confirm: string }) => {
        await api("/api/verify", { id, ...form })
        await refreshParts()
      },
      frame: async (id: string, file: string) => URL.createObjectURL(await apiBlob(`/api/part-datasheet?id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`)),
      release: (address: string) => URL.revokeObjectURL(address),
      print: (title: string, footprint: Footprint) => openPrintPage(printFootprintHtml(title, footprint)),
    }),
    [refreshParts],
  )
}
