import { CredentialList } from '@/components/credentials/credential-list'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { TestLlmPanel } from '@/components/settings/test-llm-panel'
import { Banner, SiteFooter, SiteHeader } from '@/components/site'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function SettingsPage() {
  return (
    <div className="relative min-h-screen">
      <SiteHeader />

      <Banner
        eyebrow="Configuration"
        title="Settings"
        description="模型配置、凭证管理与 LLM 连通性测试。"
        size="lg"
        accent="dusk"
      />

      <main className="mx-auto max-w-6xl px-6 py-12">
        <Tabs defaultValue="settings">
          <TabsList>
            <TabsTrigger value="settings">全局设置</TabsTrigger>
            <TabsTrigger value="credentials">凭证</TabsTrigger>
            <TabsTrigger value="test-llm">LLM 测试</TabsTrigger>
          </TabsList>
          <TabsContent value="settings">
            <SettingsPanel />
          </TabsContent>
          <TabsContent value="credentials">
            <CredentialList />
          </TabsContent>
          <TabsContent value="test-llm">
            <TestLlmPanel />
          </TabsContent>
        </Tabs>
      </main>

      <SiteFooter />
    </div>
  )
}
