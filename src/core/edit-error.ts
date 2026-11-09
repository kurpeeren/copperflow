export type EditErrorCode = "not_found" | "locked" | "readonly" | "invalid" | "parse"

export class EditError extends Error {
  constructor(
    readonly code: EditErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "EditError"
  }
}
