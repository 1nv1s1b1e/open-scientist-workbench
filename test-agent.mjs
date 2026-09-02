import { createModelFromConfig } from '@open-scientist/config';
import { createCredentialStore } from '@open-scientist/storage';
import { ToolLoopAgent, tool } from 'ai';
import { z } from 'zod';

process.env.CREDENTIAL_ENCRYPTION_KEY = 'dev-temp-key-for-local';

const store = await createCredentialStore();
const cred = await store.get('nuaa');
if (!cred) { console.log('Credential nuaa not found'); process.exit(1); }

console.log('Credential OK:', cred.provider, cred.baseURL);

const modelArg = {
  provider: cred.provider,
  model: 'qwen3.5-plus',
  baseURL: cred.baseURL,
  thinkingLevel: 'off',
  apiMode: 'chat',
  apiKey: cred.apiKey
};

const model = createModelFromConfig(modelArg);
console.log('Model created');

const testTool = tool({
  description: '搜索太阳物理论文',
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    console.log('TOOL CALLED with query:', query);
    return { papers: [{ id: 1, title: 'Coronal Heating Review', authors: ['Klimchuk'], year: 2015 }] };
  }
});

const submitTool = tool({
  description: '提交最终结果。所有自然语言字段必须使用中文。',
  inputSchema: z.object({
    result: z.string(),
  }),
});

const agent = new ToolLoopAgent({
  model,
  toolChoice: 'auto',
  maxOutputTokens: 1024,
  instructions: '你是一个太阳物理研究助手。用中文回复。先调用 searchTool 搜索论文，然后调用 submit 提交结果。',
  tools: { searchTool: testTool, submit: submitTool },
  stopWhen: [(x) => x.toolCalls.some(c => c.toolName === 'submit')],
  maxSteps: 5,
});

try {
  console.log('Starting agent.stream...');
  const result = await agent.stream({
    messages: [{ role: 'user', content: '请搜索关于日冕加热的论文并提交结果' }],
  });

  const steps = await result.steps;
  console.log('Steps:', steps.length);

  const msgs = await result.responseMessages;
  for (const m of msgs) {
    console.log(`[${m.role}]`, JSON.stringify(m.content).slice(0, 200));
  }

  const toolCalls = await result.staticToolCalls;
  console.log('Tool calls:', toolCalls.length);
  for (const tc of toolCalls) {
    console.log(`  - ${tc.toolName}:`, JSON.stringify(tc.input).slice(0, 200));
  }
} catch (e) {
  console.error('AGENT ERROR:', e.message);
  if (e.cause) console.error('Cause:', e.cause);
}
