// The hub's ticket key: made on first start and kept in <data>/ticket-key.pem, readable by its owner only. It is
// never logged and never sent anywhere; workspaces get only the public half.
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto"
import { readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { generateTicketKeys } from "../hosted/ticket.js"

export const KEY_FILE = "ticket-key.pem"
const SPKI_PREFIX_BYTES = 12

export interface TicketKeys {
  privateKey: KeyObject
  /** Base64 of the raw 32-byte public key, as COPPERFLOW_TICKET_PUBLIC_KEY takes it. */
  publicKeyBase64: string
}

/** Loads the key, or makes it when there is none. Refuses a key file others can read (where permissions mean that). */
export async function loadOrCreateTicketKey(dataDir: string, platform = process.platform): Promise<TicketKeys> {
  const file = join(dataDir, KEY_FILE)
  let pem: string
  try {
    pem = await readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    const made = generateTicketKeys()
    // "wx": two hubs starting at once cannot overwrite each other's key.
    await writeFile(file, made.privateKey.export({ format: "pem", type: "pkcs8" }).toString(), { flag: "wx", mode: 0o600 })
    pem = await readFile(file, "utf8")
  }
  if (platform !== "win32" && ((await stat(file)).mode & 0o077) !== 0) {
    throw new Error(`${KEY_FILE} in the data directory must be readable by its owner only (chmod 600)`)
  }
  let privateKey: KeyObject
  try {
    privateKey = createPrivateKey(pem)
  } catch {
    throw new Error(`${KEY_FILE} in the data directory is not a private key`)
  }
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error(`${KEY_FILE} in the data directory is not an Ed25519 key`)
  const publicKeyBase64 = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(SPKI_PREFIX_BYTES).toString("base64")
  return { privateKey, publicKeyBase64 }
}
