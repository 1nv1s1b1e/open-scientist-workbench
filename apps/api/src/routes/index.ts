import type { Hono } from 'hono'
import { artifacts } from './artifacts'
import { credentials } from './credentials'
import { devProbe } from './dev-probe'
import { health } from './health'
import { projects } from './projects'
import { runs } from './runs'
import { settings } from './settings'
import { testLlm } from './test-llm'

export function registerRoutes(app: Hono): void {
  app.route('/', health)
  app.route('/', settings)
  app.route('/', credentials)
  app.route('/', projects)
  app.route('/', testLlm)
  app.route('/', artifacts)
  app.route('/', runs)
  app.route('/', devProbe)
}

export { artifacts, credentials, devProbe, health, projects, runs, settings, testLlm }
