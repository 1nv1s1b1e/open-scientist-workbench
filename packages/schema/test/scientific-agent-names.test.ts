import { describe, expect, it } from 'vite-plus/test'
import {
  SCIENTIFIC_AGENTS,
  SCIENTIFIC_AGENT_DISPLAY_NAMES,
  scientificAgentIdentity,
  type ScientificAgentRoleKey,
} from '../src/scientific-agent-names.ts'

describe('scientific agent identities', () => {
  it('covers exactly the six stable role keys', () => {
    const keys = SCIENTIFIC_AGENTS.map((agent) => agent.key).sort()
    expect(keys).toEqual([
      'explore',
      'librarian',
      'looker',
      'oracle',
      'prometheus',
      'sisyphus',
    ])
  })

  it('keeps codenames, display names and English names unique', () => {
    const codenames = SCIENTIFIC_AGENTS.map((agent) => agent.codename)
    const displayNames = SCIENTIFIC_AGENTS.map((agent) => agent.displayName)
    const englishNames = SCIENTIFIC_AGENTS.map((agent) => agent.englishName)
    expect(new Set(codenames).size).toBe(codenames.length)
    expect(new Set(displayNames).size).toBe(displayNames.length)
    expect(new Set(englishNames).size).toBe(englishNames.length)
  })

  it('assigns every agent a valid loop stage and a one-line responsibility', () => {
    for (const agent of SCIENTIFIC_AGENTS) {
      expect(['A', 'B', 'C', 'D']).toContain(agent.stage)
      expect(agent.responsibility.length).toBeGreaterThan(8)
      expect(agent.codename.length).toBeGreaterThan(2)
    }
  })

  it('keeps the legacy display-name map aligned with the identity table', () => {
    for (const agent of SCIENTIFIC_AGENTS) {
      expect(SCIENTIFIC_AGENT_DISPLAY_NAMES[agent.key as ScientificAgentRoleKey]).toBe(
        agent.displayName,
      )
    }
    expect(Object.keys(SCIENTIFIC_AGENT_DISPLAY_NAMES)).toHaveLength(SCIENTIFIC_AGENTS.length)
  })

  it('resolves identities by key and returns undefined for unknown or empty keys', () => {
    expect(scientificAgentIdentity('oracle')?.codename).toBe('Oracle')
    expect(scientificAgentIdentity('LIBRARIAN')).toBeUndefined()
    expect(scientificAgentIdentity('')).toBeUndefined()
    expect(scientificAgentIdentity(null)).toBeUndefined()
    expect(scientificAgentIdentity(undefined)).toBeUndefined()
  })
})
