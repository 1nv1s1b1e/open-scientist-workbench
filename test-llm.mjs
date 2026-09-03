import { createModelFromConfig } from '@open-scientist/config'
import { createCredentialStore } from '@open-scientist/storage'
import { generateText } from 'ai'

process.env.CREDENTIAL_ENCRYPTION_KEY = 'dev-temp-key-for-local'

const store = await createCredentialStore()
const cred = await store.get('nuaa')
if (!cred) {
  console.log('Credential nuaa not found')
  process.exit(1)
}
console.log('Credential:', cred.provider, cred.type, 'hasKey:', !!cred.apiKey)

const modelArg = {
  provider: cred.provider,
  model: 'qwen3.5-plus',
  baseURL: cred.baseURL,
  thinkingLevel: 'off',
  apiMode: 'chat',
  apiKey: cred.apiKey,
}
console.log('Testing LLM call to:', cred.baseURL)

try {
  const langModel = createModelFromConfig(modelArg)
  console.log('Model created, calling generateText...')
  const result = await generateText({
    model: langModel,
    prompt: 'Say hello in 3 words',
    maxOutputTokens: 20,
  })
  console.log('SUCCESS:', result.text)
  console.log('Usage:', JSON.stringify(result.usage))
} catch (e) {
  console.error('LLM ERROR:', e.message)
  if (e.cause) console.error('Cause:', e.cause)
}
