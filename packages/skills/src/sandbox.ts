export interface Sandbox {
  readFile(path: string): Promise<string>
  readdir(path: string): Promise<string[]>
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

export function createNodeSandbox(): Sandbox {
  return {
    async readFile(path) {
      return (await import('node:fs/promises')).readFile(path, 'utf-8')
    },
    async readdir(path) {
      return (await import('node:fs/promises')).readdir(path)
    },
    async exec(command) {
      const { exec } = await import('node:child_process')
      return new Promise((resolve) => {
        exec(command, (error, stdout, stderr) => {
          resolve({ stdout, stderr, exitCode: error ? 1 : 0 })
        })
      })
    },
  }
}
