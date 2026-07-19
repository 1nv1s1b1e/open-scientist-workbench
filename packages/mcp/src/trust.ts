import { getTrust, setTrust } from '@open-scientist/storage'
import { detectToolDrift, fingerprintTools, type ToolSet } from 'ai'

export interface TrustResult {
  trusted: boolean
  drifted: boolean
  added: string[]
  removed: string[]
  changed: string[]
}

export async function checkMcpTrust(
  projectName: string,
  serverName: string,
  fingerprint: string,
  tools: ToolSet,
): Promise<TrustResult> {
  const existing = await getTrust(projectName, serverName)

  if (!existing) {
    // 首次连接，需用户 review
    await setTrust(projectName, serverName, fingerprint, false)
    return {
      trusted: false,
      drifted: true,
      added: Object.keys(tools),
      removed: [],
      changed: [],
    }
  }

  if (!existing.trusted) {
    return { trusted: false, drifted: false, added: [], removed: [], changed: [] }
  }

  // 检测工具漂移
  const currentFingerprint = await fingerprintTools(tools)
  const drift = detectToolDrift(currentFingerprint, JSON.parse(existing.fingerprint))
  const drifted = drift.added.length > 0 || drift.removed.length > 0 || drift.changed.length > 0
  return {
    trusted: !drifted,
    drifted,
    added: drift.added,
    removed: drift.removed,
    changed: drift.changed,
  }
}

export async function trustServer(projectName: string, serverName: string, fingerprint: string) {
  await setTrust(projectName, serverName, fingerprint, true)
}
