// A check shared by the exports that take an output file name from a person or an agent.

/**
 * Refuses a ":" in the name after a drive letter: on Windows "top.png:x.png" would write a hidden alternate data
 * stream of top.png while passing the check on the name's ending.
 */
export function refuseStreamName(out: string): void {
  if (out.replace(/^[A-Za-z]:/, "").includes(":")) throw new Error(`${out} cannot contain ":" (except after a drive letter); name a plain file, e.g. pics/top.png`)
}
