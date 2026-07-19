import type { Hono } from 'hono'
import { credentials } from './credentials'
import { health } from './health'
import { projects } from './projects'
import { settings } from './settings'
import { testLlm } from './test-llm'

export function registerRoutes(app: Hono): void {
  app.route('/', health)
  app.route('/', settings)
  app.route('/', credentials)
  app.route('/', projects)
  app.route('/', testLlm)
}

export { credentials, health, projects, settings, testLlm }
