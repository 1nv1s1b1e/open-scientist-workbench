import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const demoDir = resolve(".");
const defaultBrowserPath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browserPath = existsSync(defaultBrowserPath) ? defaultBrowserPath : undefined;
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

const args = [
  "render",
  demoDir,
  "--composition",
  "hyperframes-4k60.html",
  "--output",
  "open-scientist-4k60.mp4",
  "--fps",
  "60",
  "--quality",
  "high",
  "--workers",
  "8",
];

console.log("[HyperFrames 4K60 Render] Starting execution with configuration:");
console.log(`- Working directory: ${demoDir}`);
console.log(`- Composition: hyperframes-4k60.html`);
console.log(`- Output: open-scientist-4k60.mp4`);
console.log(`- Resolution: 3840x2160 (Native 4K Canvas)`);
console.log(`- Frame Rate: 60 FPS`);
console.log(`- Browser: ${browserPath}`);

const startTime = Date.now();
const child = spawn(
  npxCommand,
  ["--yes", "hyperframes@0.8.6", ...args],
  {
    cwd: demoDir,
    env: {
      ...process.env,
      HYPERFRAMES_TELEMETRY: "0",
      ...(browserPath ? { HYPERFRAMES_BROWSER_PATH: browserPath } : {}),
    },
    stdio: "inherit",
    shell: process.platform === "win32",
  }
);

child.on("close", (code) => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  if (code === 0) {
    console.log(`\n🎉 [HyperFrames 4K60 Render] Completed successfully in ${elapsed}s!`);
    console.log(`Output: ${resolve("open-scientist-4k60.mp4")}`);
  } else {
    console.error(`\n❌ [HyperFrames 4K60 Render] Failed with exit code ${code} after ${elapsed}s`);
    process.exit(code ?? 1);
  }
});
