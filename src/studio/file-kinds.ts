// Which files the Files tab previews, and how: the server serves only these, and the browser decides what a click does
// from the same rules. No Node imports, so the browser app can use it.

/** Text the preview shows as it is: notes, settings, code, KiCad files, Gerber layers and drill files. */
const TEXT_FILE = /\.(md|ya?ml|json|csv|txt|tsx|ts|kicad_[a-z]+|gtl|gbl|gts|gbs|gtp|gbp|gto|gbo|gm1|drl)$/i

/** Images by extension, with the type the server sends them as. */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
}

export type PreviewKind = "text" | "image"

/** The image type of a file name, or undefined when it is not an image the preview shows. */
export function imageType(path: string): string | undefined {
  const dot = path.lastIndexOf(".")
  return dot < 0 || dot < path.lastIndexOf("/") ? undefined : IMAGE_TYPES[path.slice(dot).toLowerCase()]
}

/** How the preview shows the file, or undefined when it does not. */
export function previewKind(path: string): PreviewKind | undefined {
  if (imageType(path) !== undefined) return "image"
  return TEXT_FILE.test(path) ? "text" : undefined
}
