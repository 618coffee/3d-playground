import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appUrl = process.env.SMOKE_URL ?? 'http://127.0.0.1:4173/';
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debugPort = Number(process.env.CHROME_DEBUG_PORT ?? 9223);

const profileDir = await mkdtemp(join(tmpdir(), 'mesh-smoke-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const chromeExit = new Promise((resolve) => chrome.once('exit', resolve));

let pageWsUrl;

try {
  await waitForDevTools(debugPort);
  pageWsUrl = await createPage(debugPort, appUrl);
  const client = await connectDevTools(pageWsUrl);
  const diagnostics = [];
  client.on('Runtime.exceptionThrown', (event) => diagnostics.push({ type: 'exception', event }));
  client.on('Log.entryAdded', (event) => diagnostics.push({ type: 'log', event }));
  client.on('Network.loadingFailed', (event) => diagnostics.push({ type: 'networkFailed', event }));
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  await client.send('Network.enable');
  await client.send('Page.enable');
  await client.send('Page.navigate', { url: appUrl });
  await waitForLoad(client);
  await waitForAppReady(client, diagnostics);
  await client.send('Runtime.evaluate', { expression: 'document.fonts?.ready', awaitPromise: true });

  const smokeResult = await evaluate(client, async () => {
    const byText = (text) => [...document.querySelectorAll('button, span, strong, div')].find((item) => item.textContent?.includes(text));
    const hasCanvas = Boolean(document.querySelector('canvas'));
    const hasSample = Boolean(byText('Blue titanium fan stage'));
    const textarea = document.querySelector('textarea');
    if (!textarea) {
      throw new Error(`AI textarea not found at ${location.href}; body=${document.body.innerText.slice(0, 300)}`);
    }
    textarea.value = '把当前对象绕 Z 轴旋转 30 度';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const parseButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('解析'));
    parseButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const executeButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('执行'));
    executeButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const hasTimeline = Boolean(byText('rotateMesh'));
    const hasStatus = Boolean(byText('已旋转 30 度'));
    return { hasCanvas, hasSample, hasTimeline, hasStatus };
  });

  if (!smokeResult.hasCanvas || !smokeResult.hasSample || !smokeResult.hasTimeline || !smokeResult.hasStatus) {
    throw new Error(`Smoke checks failed: ${JSON.stringify(smokeResult)}`);
  }

  console.log(`Browser smoke passed at ${appUrl}`);
} finally {
  if (!chrome.killed) chrome.kill('SIGTERM');
  await Promise.race([chromeExit, sleep(1_000)]);
  await rm(profileDir, { recursive: true, force: true });
}

async function waitForDevTools(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error('Timed out waiting for Chrome DevTools');
}

async function createPage(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Could not create page: ${response.status}`);
  const page = await response.json();
  return page.webSocketDebuggerUrl;
}

async function connectDevTools(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method) {
      listeners.get(message.method)?.forEach((listener) => listener(message.params));
      return;
    }
    if (!message.id) return;
    const handlers = pending.get(message.id);
    if (!handlers) return;
    pending.delete(message.id);
    if (message.error) handlers.reject(new Error(message.error.message));
    else handlers.resolve(message.result);
  });
  return {
    on(method, listener) {
      const items = listeners.get(method) ?? [];
      items.push(listener);
      listeners.set(method, items);
    },
    send(method, params = {}) {
      const nextId = id += 1;
      socket.send(JSON.stringify({ id: nextId, method, params }));
      return new Promise((resolve, reject) => pending.set(nextId, { resolve, reject }));
    },
  };
}

async function waitForLoad(client) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = await evaluate(client, () => document.readyState);
    if (state === 'complete') return;
    await sleep(100);
  }
  throw new Error('Timed out waiting for page load');
}

async function waitForAppReady(client, diagnostics) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const ready = await evaluate(client, () => ({
      href: location.href,
      hasRoot: Boolean(document.querySelector('#root')),
      hasTextarea: Boolean(document.querySelector('textarea')),
      hasCanvas: Boolean(document.querySelector('canvas')),
      text: document.body.innerText.slice(0, 200),
    }));
    if (ready.href === appUrl && ready.hasRoot && ready.hasTextarea && ready.hasCanvas) return;
    await sleep(150);
  }
  const lastState = await evaluate(client, () => ({
    href: location.href,
    text: document.body.innerText.slice(0, 500),
    html: document.body.innerHTML.slice(0, 500),
  }));
  throw new Error(`Timed out waiting for React workbench: ${JSON.stringify({ lastState, diagnostics: diagnostics.slice(-8) })}`);
}

async function evaluate(client, fn) {
  const result = await client.send('Runtime.evaluate', {
    expression: `(${fn})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Evaluation failed');
  return result.result.value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
