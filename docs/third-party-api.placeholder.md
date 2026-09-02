# 第三方 API 占位配置

本文件只是待补参数模板，不会被程序自动读取，也不应写入真实 API key。真实参数提供后，再通过 Settings 页面或 API 写入 `data/global.sqlite`。

## 待提供字段

```text
credential id: third-party-placeholder
provider: __WAITING_FOR_PROVIDER__     # openai 或 anthropic
api key: __WAITING_FOR_API_KEY__
baseURL: https://placeholder.invalid/v1
model: __WAITING_FOR_MODEL_ID__
apiMode: chat                         # OpenAI 兼容网关通常使用 chat
thinkingLevel: medium
```

`provider=openai` 仅表示第三方端点遵循 OpenAI Chat Completions 兼容协议，并不表示请求发送到 OpenAI 官方服务。若供应商使用 Anthropic Messages 兼容协议，改用 `provider=anthropic`；若两者都不兼容，需要先补 provider 适配代码。

## 收到真实参数后的 PowerShell 配置模板

先确认 API 服务已启动，并将尖括号中的占位符替换为真实值。不要把替换后的命令或 key 提交到 Git、日志或公共文档。

```powershell
$credential = @{
  id = 'third-party-api'
  provider = 'openai'
  type = 'api-key'
  key = '<API_KEY>'
  baseURL = '<BASE_URL>'
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri 'http://localhost:3000/api/credentials' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $credential

$model = @{
  model = '<MODEL_ID>'
  thinkingLevel = 'medium'
  apiMode = 'chat'
  credentialId = 'third-party-api'
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri 'http://localhost:3000/api/settings/models/default' `
  -Method Put `
  -ContentType 'application/json' `
  -Body $model
```

配置后用 `GET /api/credentials` 只检查 `id`、`provider`、`baseURL` 和 `hasKey`，不要输出或记录明文 key；再从 Settings 页面执行一次小请求验证连通性。
