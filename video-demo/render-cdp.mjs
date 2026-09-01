import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\//, '').replaceAll('/', '\\');
const outDir = process.argv[2] || join(ROOT, 'render-current');
const seconds = Math.min(Number(process.argv[3] || 340), 340);
const port = Number(process.argv[4] || 9222);
const recordScale = Math.max(0.25, Math.min(Number(process.argv[5] || 0.5), 1));
const chrome = process.env.OPEN_SCIENTIST_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

if (!existsSync(chrome)) throw new Error(`Chrome not found: ${chrome}`);
mkdirSync(outDir, { recursive: true });
const expected = join(outDir, 'open-scientist-4k60.webm');
const partial = `${expected}.part`;
if (existsSync(expected)) unlinkSync(expected);
if (existsSync(partial)) unlinkSync(partial);

const uploadServer = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Recording-Name');
  if (request.method === 'OPTIONS') { response.statusCode = 204; response.end(); return; }
  if (request.method !== 'POST' || !request.url?.startsWith('/chunk') && request.url !== '/finish') { response.statusCode = 404; response.end(); return; }
  if (request.method === 'POST' && request.url === '/finish') {
    if (!existsSync(partial)) { response.statusCode = 400; response.end('no chunks'); return; }
    renameSync(partial, expected);
    response.statusCode = 200;
    response.end('ok');
    return;
  }
  const stream = createWriteStream(partial, { flags: 'a' });
  request.pipe(stream);
  stream.on('finish', () => {
    response.statusCode = 200;
    response.end('ok');
  });
  stream.on('error', (error) => {
    response.statusCode = 500;
    response.end(error.message);
  });
});
const uploadPort = await new Promise((resolve, reject) => {
  uploadServer.once('error', reject);
  uploadServer.listen(0, '127.0.0.1', () => resolve(uploadServer.address().port));
});

const profile = join(tmpdir(), `open-scientist-render-${Date.now()}`);
const chromeArgs = [
  '--headless=new',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--window-size=3840,2160',
  'about:blank'
];

const child = spawn(chrome, chromeArgs, { windowsHide: true, stdio: 'ignore' });
let socket;
let browserSocket;
let messageId = 0;
let browserMessageId = 0;
const pending = new Map();

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForJson(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    socket = new WebSocket(wsUrl);
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', (event) => reject(event.error || new Error('CDP websocket error')));
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve: accept, reject: deny } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) deny(new Error(message.error.message)); else accept(message.result);
      }
    });
  });
}

function connectBrowser(wsUrl) {
  return new Promise((resolve, reject) => {
    browserSocket = new WebSocket(wsUrl);
    browserSocket.addEventListener('open', () => resolve());
    browserSocket.addEventListener('error', (event) => reject(event.error || new Error('Browser websocket error')));
  });
}

function browserCall(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++browserMessageId;
    const handle = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      browserSocket.removeEventListener('message', handle);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    };
    browserSocket.addEventListener('message', handle);
    browserSocket.send(JSON.stringify({ id, method, params }));
  });
}

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function closeChrome() {
  try { socket?.close(); } catch {}
  try { browserSocket?.close(); } catch {}
  try { child.kill(); } catch {}
  await wait(500);
  if (!child.killed) {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  }
}

try {
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const tabs = await waitForJson(`http://127.0.0.1:${port}/json/list`);
  const tab = tabs.find((item) => item.type === 'page');
  if (!tab?.webSocketDebuggerUrl) throw new Error('No page target exposed by Chrome');
  await connectBrowser(version.webSocketDebuggerUrl);
  await browserCall('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: outDir, eventsEnabled: true });
  await connect(tab.webSocketDebuggerUrl);
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: outDir });
  await call('Page.navigate', { url: `http://127.0.0.1:4173/?record=1&recordSeconds=${seconds}&recordScale=${recordScale}&uploadPort=${uploadPort}` });

  const started = Date.now();
  const timeout = Math.round((seconds + 35) * 1000);
  console.log(`recording ${seconds}s at 3840x2160 / 60fps`);
  while (Date.now() - started < timeout) {
    try {
      const state = await call('Runtime.evaluate', {
        expression: 'document.title + "|" + (window.__hfRecordingStatus || "booting")',
        returnByValue: true
      });
      const status = state?.result?.value || '';
      if (status.includes('RECORDING_ERROR') || status.includes('|error:')) throw new Error(status);
      if (status.includes('RECORDING_DONE')) console.log(status);
    } catch (error) {
      if (error.message?.includes('RECORDING_ERROR') || error.message?.includes('|error:')) throw error;
    }
    if (existsSync(expected)) break;
    await wait(1000);
    if ((Date.now() - started) % 10000 < 1000) console.log(`elapsed ${Math.floor((Date.now() - started) / 1000)}s`);
  }
  if (!existsSync(expected)) throw new Error(`Recording did not finish within ${timeout / 1000}s`);
  console.log(`saved ${expected}`);
} finally {
  try { uploadServer.close(); } catch {}
  await closeChrome();
}
