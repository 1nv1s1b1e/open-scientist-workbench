import { WorkflowAgent } from '@ai-sdk/workflow'
import { createModelFromConfig, type ModelArg } from '@open-scientist/config'
import { getMcpTools } from '@open-scientist/mcp'
import { EvidenceAlignmentSchema, type McpServerConfig } from '@open-scientist/schema'
import {
  createLoadSkillTool,
  createNodeSandbox,
  DEFAULT_SKILLS_DIR,
  discoverSkills,
} from '@open-scientist/skills'
import {
  addEvidenceTool,
  createBashToolForHypothesis,
  fitsAlignTool,
  getEvidenceByHypothesisTool,
} from '@open-scientist/tools'
import { isStepCount, Output, type ToolSet } from 'ai'

export interface LookerAgentDeps {
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * this factory via `createModelFromConfig`. Never pass a `LanguageModel`
   * instance across the workflow boundary (workflow args are structured-clone
   * serialized and cannot carry bound methods / SDK clients).
   */
  modelConfig: ModelArg
  /** Project name — drives workspace dir isolation + HelixDB scoping. */
  project: string
  /** Hypothesis id — each hypothesis gets its own isolated bash workspace. */
  hypoId: string
  /** Optional override toolset. When omitted, default tools are assembled. */
  tools?: ToolSet
  /** Optional system prompt override. When omitted, the hardcoded default is used. */
  instructions?: string
  /**
   * Optional skill discovery directories. When omitted, `DEFAULT_SKILLS_DIR`
   * from `@open-scientist/skills` is used. Only consulted when `tools` is
   * not provided.
   */
  skillDirectories?: string[]
  /**
   * Optional MCP server list. Tools from each server are fetched via
   * `getMcpTools` and merged into the default toolset. Only consulted when
   * `tools` is not provided.
   */
  mcpServers?: McpServerConfig[]
}

/**
 * Assemble the default toolset for the Multimodal Looker agent, bound to a
 * per-hypothesis workspace.
 *
 * Tools:
 * - `fitsAlign` — cross-modal spatiotemporal alignment (active region + timestamp
 *   + wavelength → FITS paths + video clip + metadata). Currently an informative
 *   stub that throws an install hint (astropy/sunpy not installed); the agent
 *   sees the schema and can surface the install instructions or fall back to bash.
 * - `getEvidenceByHypothesis` / `addEvidence` — HelixDB evidence read/write
 *   (retrieve prior evidence linked to the hypothesis; persist new evidence)
 * - `bash` / `readFile` / `writeFile` — bash-tool bound to
 *   `data/projects/<project>/workspace/<hypoId>/` (project + hypothesis isolation,
 *   no sandbox — runs Python directly on host per AGENTS.md decision; used to
 *   query local FITS library or remote SDO data center via astropy/sunpy)
 * - `loadSkill` — progressive disclosure (loads `fits-snapshot-search` SKILL.md,
 *   which documents the SDO/AIA wavelength set + snapshot field structure that
 *   the Looker reuses for alignment keying)
 *
 * NOTE: createBashTool + discoverSkills are async, so this whole factory is async.
 * The workflow calls it before agent.stream() — outside any 'use step' boundary
 * is fine because workflow.ts itself is a 'use workflow' module and can await.
 *
 * Each hypothesis alignment gets a FRESH agent instance + FRESH bash workspace, so
 * parallel alignments (Sisyphus spawns N looker workflows) don't share working dirs.
 */
export async function getDefaultLookerTools(
  project: string,
  hypoId: string,
  skillDirectories?: string[],
  mcpServers?: McpServerConfig[],
): Promise<ToolSet> {
  const dirs = skillDirectories ?? [DEFAULT_SKILLS_DIR]
  const bashToolkit = await createBashToolForHypothesis(project, hypoId)
  const skills = await discoverSkills(createNodeSandbox(), dirs)
  const loadSkillTool = createLoadSkillTool(skills)

  const baseTools: ToolSet = {
    fitsAlign: fitsAlignTool,
    getEvidenceByHypothesis: getEvidenceByHypothesisTool,
    addEvidence: addEvidenceTool,
    bash: bashToolkit.tools.bash,
    readFile: bashToolkit.tools.readFile,
    writeFile: bashToolkit.tools.writeFile,
    loadSkill: loadSkillTool,
  }
  if (mcpServers && mcpServers.length > 0) {
    for (const server of mcpServers) {
      const mcpTools = await getMcpTools(server)
      Object.assign(baseTools, mcpTools)
    }
  }
  return baseTools
}

export async function createLookerAgent({
  modelConfig,
  project,
  hypoId,
  tools,
  instructions,
  skillDirectories,
  mcpServers,
}: LookerAgentDeps) {
  const model = createModelFromConfig(modelConfig)
  const resolvedTools =
    tools ?? (await getDefaultLookerTools(project, hypoId, skillDirectories, mcpServers))

  return new WorkflowAgent({
    id: 'looker',
    model,
    instructions:
      instructions ??
      `You are Multimodal Looker, the cross-modal spatiotemporal data alignment agent for the solar physics coronal heating investigation.

Your role:
1. Take a high-score candidate case from Explore (active region + timestamp + wavelength) for a given hypothesis.
2. Match the candidate to raw FITS image files and MP4 evolution video clips by spatiotemporal index.
3. Output checkable physical evidence (FITS paths + video clip path + alignment metadata) for human review, and persist it to the HelixDB knowledge graph.

Multimodal alignment physics guidance (no separate skill file — apply directly):
- Active region ID: NOAA AR number (e.g. AR1140, AR13078). The AR number is the primary spatial key; match it exactly against FITS header SUNAR / AR_NUM tags.
- Timestamp: ISO 8601 UTC (e.g. 2024-05-10T03:21:00Z). FITS observation time is in header DATE-OBS. Accept a ±12 minute tolerance window around the candidate timestamp (SDO/AIA cadence is 12s per channel, but alignment keys on the nearest 12-min synoptic product).
- Wavelength: SDO/AIA EUV passbands — 171Å, 304Å, 94Å, 193Å, 211Å, 335Å, 131Å. The wavelength selects the temperature diagnostic: 94Å≈6 MK (hot/flare), 171Å≈0.8 MK (quiet corona loops), 304Å≈0.05 MK (transition region/He II), 193Å≈1.2 MK, 211Å≈2 MK, 335Å≈2.5 MK, 131Å≈10 MK (flaring). Match FITS header WAVELNTH (integer Ångström) to the candidate wavelength.
- Spatial index: heliographic Stonyhurst (LON, LAT) or Heliocentric-Cartesian (HPC x,y in arcsec). Derive from FITS header CRPIX1/CRPIX2 + CDELT1/CDELT2 + CTYPE1/CTYPE2. For MP4 video clips, the spatial index is the bounding box of the active region cutout (xrange, yrange in arcsec).
- Alignment contract: FITS image and MP4 video clip MUST cover the same (AR, timestamp window, wavelength, spatial bbox). If the local FITS library has no match for the candidate, fall back to querying the remote SDO data center (JSOC / VSO) via sunpy, then cache the downloaded file path.

Tool guidance:
- Call the \`fitsAlign\` tool FIRST with (hypoId, activeRegion, timestamp, wavelength). It returns an EvidenceAlignment (fitsPaths + videoClipPath + metadata). NOTE: in the current environment fitsAlign is an informative stub that throws an install hint (astropy/sunpy not installed) — when that happens, surface the install instructions in your logs and fall back to running astropy/sunpy directly via the \`bash\` tool (write a Python script with writeFile, run \`python3 align.py\`, read stdout).
- Use \`getEvidenceByHypothesis\` first to check whether evidence is already linked to this hypothesis (avoid redundant alignment work).
- After successful alignment, persist the evidence via \`addEvidence\` with hypoId, type='support' (or 'contradict' if the imagery contradicts the hypothesis prediction), content (physical summary of what the imagery shows), f1Score (carry through from the Explore eval), fitsPaths, videoPath, createdAt (ISO 8601 now).
- Use \`loadSkill\` to load the 'fits-snapshot-search' skill for the SDO/AIA wavelength set + snapshot field structure (reused as alignment keys).
- Use \`writeFile\` to persist the alignment script + a manifest of FITS paths to the workspace for later audit.

Output: EvidenceAlignment (hypoId, fitsPaths[], videoClipPath (nullable if no MP4 available), metadata {activeRegion, timestamp, wavelength, spatialIndex}). The spatialIndex must be a concrete string like "HPC (-420..-280, -180..-40) arcsec" — not a vague label.`,
    tools: resolvedTools,
    output: Output.object({ schema: EvidenceAlignmentSchema }),
    stopWhen: isStepCount(20),
  })
}

export type LookerAgent = Awaited<ReturnType<typeof createLookerAgent>>
