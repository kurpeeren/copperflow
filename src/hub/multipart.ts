// A strict multipart/form-data reader for the one form that sends a file (project upload): a few short text fields
// and at most one file. Anything else is refused.
import { HubError } from "./http.js"

export interface MultipartForm {
  fields: Map<string, string>
  file?: { field: string; data: Buffer }
}

const MAX_PARTS = 8
const MAX_FIELD_BYTES = 4096
const MAX_HEADER_BYTES = 1024
const BOUNDARY = /^[0-9A-Za-z'()+_,\-./:=?]{1,70}$/

export function boundaryOf(contentType: string | undefined): string {
  const match = /^multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^\s;]+))\s*$/i.exec(contentType ?? "")
  const boundary = match?.[1] ?? match?.[2]
  if (!boundary || !BOUNDARY.test(boundary)) throw new HubError(415, "Send the archive with the upload form.")
  return boundary
}

function nameOf(disposition: string, key: "name" | "filename"): string | undefined {
  const match = new RegExp(`;\\s*${key}="([^"\\r\\n]*)"`, "i").exec(disposition)
  return match?.[1]
}

export function readMultipart(body: Buffer, boundary: string): MultipartForm {
  const bad = () => new HubError(400, "The upload form is not valid.")
  const delimiter = Buffer.from(`--${boundary}`)
  if (body.indexOf(delimiter) !== 0) throw bad()
  const fields = new Map<string, string>()
  let file: MultipartForm["file"]
  let at = delimiter.length
  for (let parts = 0; ; parts += 1) {
    if (body.subarray(at, at + 2).toString() === "--") break
    if (parts >= MAX_PARTS || body.subarray(at, at + 2).toString() !== "\r\n") throw bad()
    const headerEnd = body.indexOf("\r\n\r\n", at + 2)
    if (headerEnd < 0 || headerEnd - at > MAX_HEADER_BYTES) throw bad()
    const headers = body.subarray(at + 2, headerEnd).toString("utf8").split("\r\n")
    const disposition = headers.find((line) => /^content-disposition:/i.test(line)) ?? ""
    if (!/^content-disposition:\s*form-data\s*;/i.test(disposition)) throw bad()
    const name = nameOf(disposition, "name")
    if (!name) throw bad()
    const end = body.indexOf(Buffer.concat([Buffer.from("\r\n"), delimiter]), headerEnd + 4)
    if (end < 0) throw bad()
    const content = body.subarray(headerEnd + 4, end)
    if (nameOf(disposition, "filename") !== undefined) {
      if (file) throw bad()
      file = { field: name, data: content }
    } else {
      if (fields.has(name) || content.length > MAX_FIELD_BYTES) throw bad()
      fields.set(name, content.toString("utf8"))
    }
    at = end + 2 + delimiter.length
  }
  return file ? { fields, file } : { fields }
}
