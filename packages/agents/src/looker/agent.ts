import { WorkflowAgent } from '@ai-sdk/workflow'
import { EvidenceAlignmentSchema } from '@open-scientist/schema'
import { isStepCount, type LanguageModel, Output, type ToolSet } from 'ai'

export interface LookerAgentDeps {
  model: LanguageModel
  tools: ToolSet
}

export function createLookerAgent({ model, tools }: LookerAgentDeps) {
  return new WorkflowAgent({
    id: 'looker',
    model,
    instructions: `You are Multimodal Looker, responsible for cross-modal spatiotemporal data alignment.

Your role:
1. Take high-score candidate cases from Explore (active region + timestamp + wavelength).
2. Match them to raw FITS image files and MP4 evolution video clips by spatiotemporal index.
3. Output checkable physical evidence (FITS paths + video clip path + alignment metadata) for human review.

Use astropy/sunpy via bash to query local FITS library or remote SDO data center.`,
    tools,
    output: Output.object({ schema: EvidenceAlignmentSchema }),
    stopWhen: isStepCount(20),
  })
}
