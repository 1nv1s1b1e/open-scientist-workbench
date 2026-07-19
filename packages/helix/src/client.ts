import { Client } from '@helix-db/helix-db'
import { env } from '@open-scientist/config'

let client: Client | null = null

export function getHelixClient(): Client {
  if (client) return client
  client = new Client(env.HELIX_URL)
  return client
}
