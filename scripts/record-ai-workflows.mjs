import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const appUrl = process.env.RECORD_URL ?? 'http://127.0.0.1:5173/';
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debugPort = Number(process.env.CHROME_DEBUG_PORT ?? 9233);
const outputDir = resolve(process.env.RECORD_OUTPUT_DIR ?? 'artifacts/ai-workflow-recordings');
const frameRate = Number(process.env.RECORD_FPS ?? 10);
const viewport = { width: 1440, height: 900, deviceScaleFactor: 1 };

const scenarios = [
  {
    id: '01-move-selection-x-20mm',
    select: async () => {
      await window.__demo.clickObject('Blue titanium fan stage');
      await window.__demo.clickObject('Warm stator vane stage', { metaKey: true });
    },
    prompt: '将选中对象沿着x轴正方向移动20mm',
    confirmLabels: [/确认(执行|应用)/],
    waitForHistory: 'moveMesh',
    response: (request) => actionDraft(request, {
      type: 'moveMesh',
      target: { source: 'selection' },
      params: { offset: [20, 0, 0], unit: request.scene.unit },
      explanation: '沿 X 轴正方向移动 20 mm。',
    }),
  },
  {
    id: '02-rotate-nacelle-z-90deg',
    select: async () => {
      await window.__demo.clickObject('Nacelle translucent casing');
    },
    prompt: '把当前对象绕 Z 轴旋转 90 度',
    confirmLabels: [/确认(执行|应用)/],
    waitForHistory: 'rotateMesh',
    response: (request) => actionDraft(request, {
      type: 'rotateMesh',
      target: { source: 'selection' },
      params: { axis: 'z', angleDeg: 90, pivot: 'boundsCenter', space: 'world' },
      explanation: '绕 Z 轴旋转当前选中对象 90 度。',
    }),
  },
  {
    id: '03-clone-stator-x-10mm',
    select: async () => {
      await window.__demo.clickObject('Warm stator vane stage');
    },
    prompt: '复制选中对象 1 个，沿 X 方向间隔 10mm',
    confirmLabels: [/确认(执行|应用)/],
    waitForHistory: 'cloneMesh',
    response: (request) => actionDraft(request, {
      type: 'cloneMesh',
      target: { source: 'selection' },
      params: { count: 1, offset: [10, 0, 0], unit: request.scene.unit, shareGeometry: true, namePattern: '{name}-copy-{n}' },
      explanation: '复制 1 个选中对象，并沿 X 方向间隔 10 mm。',
    }),
  },
  {
    id: '04-clip-all-z0-positive',
    select: async () => {
      await window.__demo.clickObject('Nacelle translucent casing');
      await window.__demo.clickObject('Aft nozzle cone', { shiftKey: true });
    },
    prompt: '在z=0 平面切开选中对象，只保留z >=0 部分',
    confirmLabels: [/应用切割/],
    waitForHistory: 'clipMesh',
    response: (request) => actionDraft(request, {
      type: 'clipMesh',
      target: { source: 'selection' },
      params: { plane: { origin: [0, 0, 0], normal: [0, 0, 1] }, keepSide: 'positive', mode: 'applyVisualClip', cap: true },
      explanation: '在 Z=0 平面生成视觉切割，只保留 Z 正侧。',
      risk: reviewRisk('视觉切割需要检查预览后应用。', ['视觉切割会改变当前视图中的可见几何范围。']),
    }),
  },
];

await mkdir(outputDir, { recursive: true });
const profileDir = await mkdtempCompat('mesh-ai-recording-');
const chrome = spawn(chromePath, [
  '--headless=new',
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  `--window-size=${viewport.width},${viewport.height}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const chromeExit = new Promise((resolve) => chrome.once('exit', resolve));

try {
  await waitForDevTools(debugPort);
  for (const scenario of scenarios) {
    const outputPath = join(outputDir, `${scenario.id}.mp4`);
    await recordScenario(scenario, outputPath);
    console.log(`Recorded ${outputPath}`);
  }
} finally {
  if (!chrome.killed) chrome.kill('SIGTERM');
  await Promise.race([chromeExit, sleep(1_000)]);
  await rm(profileDir, { recursive: true, force: true });
}

async function recordScenario(scenario, outputPath) {
  const pageWsUrl = await createPage(debugPort, appUrl);
  const client = await connectDevTools(pageWsUrl);
  const diagnostics = [];
  client.on('Runtime.exceptionThrown', (event) => diagnostics.push({ type: 'exception', event }));
  client.on('Fetch.requestPaused', async (event) => {
    try {
      if (!event.request.url.includes('/api/agent/respond')) {
        await client.send('Fetch.continueRequest', { requestId: event.requestId });
        return;
      }
      const request = JSON.parse(event.request.postData || '{}');
      await sleep(450);
      await client.send('Fetch.fulfillRequest', {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(scenario.response(request))).toString('base64'),
      });
    } catch (error) {
      await client.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' });
      console.error(error);
    }
  });

  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/agent/respond*', requestStage: 'Request' }] });
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "localStorage.removeItem('industrial-sim.agentChatSessions.v1');",
  });
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: false,
  });
  await client.send('Page.navigate', { url: appUrl });
  await waitForLoad(client);
  await waitForAppReady(client, diagnostics);
  await client.send('Runtime.evaluate', { expression: 'document.fonts?.ready', awaitPromise: true });
  await evaluate(client, installDemoCursor);

  const framesDir = await mkdtempCompat(`frames-${scenario.id}-`);
  let frameIndex = 0;
  let recording = true;
  const captureTask = (async () => {
    while (recording) {
      try {
        const frame = await client.send('Page.captureScreenshot', { format: 'jpeg', quality: 86, fromSurface: true });
        frameIndex += 1;
        await writeFile(join(framesDir, `frame-${String(frameIndex).padStart(5, '0')}.jpg`), Buffer.from(frame.data, 'base64'));
      } catch {
        // Ignore transient capture failures during layout updates.
      }
      await sleep(1000 / frameRate);
    }
  })();

  try {
    await evaluate(client, scenario.select);
    await sendPrompt(client, scenario.prompt);
    for (const label of scenario.confirmLabels) {
      console.log(`${scenario.id}: waiting for ${label}`);
      try {
        await evaluate(client, async (labelSource) => {
          const label = new RegExp(labelSource);
          await window.__demo.waitForButton(label, 10_000);
          await window.__demo.clickButton(label);
          await window.__demo.sleep(700);
        }, label.source);
      } catch (error) {
        const debugState = await evaluate(client, () => ({
          buttons: [...document.querySelectorAll('button')].map((button) => ({
            text: button.textContent?.trim(),
            label: button.getAttribute('aria-label'),
            disabled: button.disabled,
          })).slice(-30),
          tail: document.body.innerText.slice(-1800),
        })).catch((debugError) => ({ debugError: String(debugError) }));
        throw new Error(`${scenario.id} could not click ${label}: ${error.message}\n${JSON.stringify(debugState, null, 2)}`);
      }
    }
    await evaluate(client, async (historyText) => {
      await window.__demo.waitForText(historyText, 10_000);
      await window.__demo.sleep(900);
    }, scenario.waitForHistory);
  } finally {
    recording = false;
    await captureTask;
    await encodeFrames(framesDir, outputPath);
    await rm(framesDir, { recursive: true, force: true });
  }
}

async function sendPrompt(client, prompt) {
  await evaluate(client, async (nextPrompt) => {
    await window.__demo.typePrompt(nextPrompt);
    await window.__demo.clickButton(/发送指令/);
    await window.__demo.waitForText('操作草稿', 10_000);
    await window.__demo.sleep(500);
  }, prompt);
}

function actionDraft(request, options) {
  return {
    kind: 'actionDraft',
    action: {
      id: `${options.type}-${Date.now().toString(36)}`,
      type: options.type,
      target: options.target,
      params: options.params,
      source: 'agent',
      rawText: request.text,
      confirmed: false,
    },
    explanation: options.explanation,
    confidence: 0.93,
    risk: options.risk ?? lowRisk(),
  };
}

function lowRisk() {
  return { level: 'low', summary: '浏览器内可撤销的查看器操作。', warnings: [], requiresConfirmation: false, reversible: true };
}

function reviewRisk(summary, warnings = []) {
  return { level: warnings.length > 0 ? 'medium' : 'low', summary, warnings, requiresConfirmation: true, reversible: true };
}

function installDemoCursor() {
  const style = document.createElement('style');
  style.textContent = `
    .demo-cursor {
      position: fixed;
      left: 28px;
      top: 28px;
      z-index: 2147483647;
      width: 28px;
      height: 28px;
      border: 3px solid #ffd23f;
      border-radius: 999px;
      box-shadow: 0 0 0 3px rgba(18, 24, 33, 0.88), 0 8px 28px rgba(0, 0, 0, 0.36);
      pointer-events: none;
      transform: translate(-50%, -50%);
      transition: left 260ms cubic-bezier(.2,.9,.2,1), top 260ms cubic-bezier(.2,.9,.2,1);
    }
    .demo-cursor::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #ff4d4d;
      transform: translate(-50%, -50%);
    }
    .demo-click-ring {
      position: fixed;
      z-index: 2147483646;
      width: 48px;
      height: 48px;
      border: 4px solid #ff4d4d;
      border-radius: 999px;
      pointer-events: none;
      transform: translate(-50%, -50%) scale(.45);
      animation: demo-click-ring 700ms ease-out forwards;
    }
    @keyframes demo-click-ring {
      0% { opacity: .95; transform: translate(-50%, -50%) scale(.45); }
      100% { opacity: 0; transform: translate(-50%, -50%) scale(1.55); }
    }
  `;
  document.head.append(style);
  const cursor = document.createElement('div');
  cursor.className = 'demo-cursor';
  document.body.append(cursor);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const allButtons = () => [...document.querySelectorAll('button')].filter((button) => !button.disabled);
  const byButtonText = (pattern) => allButtons().find((button) => pattern.test(button.textContent?.trim() || button.getAttribute('aria-label') || ''));
  const byObjectName = (name) => [...document.querySelectorAll('.object-select-button')].find((button) => button.textContent?.includes(name));
  const center = async (element) => {
    element.scrollIntoView({ block: 'center', inline: 'center' });
    await sleep(80);
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const moveTo = async (point) => {
    cursor.style.left = `${Math.round(point.x)}px`;
    cursor.style.top = `${Math.round(point.y)}px`;
    await sleep(300);
  };
  const pulse = (point) => {
    const ring = document.createElement('div');
    ring.className = 'demo-click-ring';
    ring.style.left = `${Math.round(point.x)}px`;
    ring.style.top = `${Math.round(point.y)}px`;
    document.body.append(ring);
    setTimeout(() => ring.remove(), 760);
  };
  const clickElement = async (element, options = {}) => {
    const point = await center(element);
    await moveTo(point);
    pulse(point);
    const eventOptions = { bubbles: true, cancelable: true, button: 0, clientX: point.x, clientY: point.y, ...options };
    element.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
    element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    await sleep(60);
    element.dispatchEvent(new PointerEvent('pointerup', eventOptions));
    element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    element.dispatchEvent(new MouseEvent('click', eventOptions));
    await sleep(260);
  };
  const setNativeValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  };
  const waitFor = async (predicate, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) return value;
      await sleep(80);
    }
    const value = predicate();
    if (value) return value;
    throw new Error('Timed out waiting for UI condition');
  };

  window.__demo = {
    sleep,
    waitForText: (text, timeoutMs) => waitFor(() => document.body.innerText.includes(text), timeoutMs),
    waitForButton: (pattern, timeoutMs) => waitFor(() => byButtonText(pattern), timeoutMs),
    clickButton: async (pattern) => clickElement(await waitFor(() => byButtonText(pattern), 10_000)),
    clickObject: async (name, options = {}) => clickElement(await waitFor(() => byObjectName(name), 10_000), options),
    typePrompt: async (prompt) => {
      const textarea = await waitFor(() => document.querySelector('textarea[aria-label="AI 指令输入"]'), 10_000);
      await clickElement(textarea);
      setNativeValue(textarea, '');
      let current = '';
      for (const char of [...prompt]) {
        current += char;
        setNativeValue(textarea, current);
        await sleep(18);
      }
      await sleep(220);
    },
  };
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
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const ready = await evaluate(client, () => ({
      href: location.href,
      hasRoot: Boolean(document.querySelector('#root')),
      hasTextarea: Boolean(document.querySelector('textarea[aria-label="AI 指令输入"]')),
      hasCanvas: Boolean(document.querySelector('canvas')),
      hasTurbofan: document.body.innerText.includes('Blue titanium fan stage'),
    }));
    if (ready.href.startsWith(appUrl) && ready.hasRoot && ready.hasTextarea && ready.hasCanvas && ready.hasTurbofan) return;
    await sleep(150);
  }
  const lastState = await evaluate(client, () => ({ text: document.body.innerText.slice(0, 500), html: document.body.innerHTML.slice(0, 500) }));
  throw new Error(`Timed out waiting for workbench: ${JSON.stringify({ lastState, diagnostics: diagnostics.slice(-8) })}`);
}

async function evaluate(client, fn, arg) {
  const expression = arg === undefined ? `(${fn})()` : `(${fn})(${JSON.stringify(arg)})`;
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Evaluation failed');
  return result.result.value;
}

async function encodeFrames(framesDir, outputPath) {
  await new Promise((resolvePromise, rejectPromise) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-framerate', String(frameRate),
      '-i', join(framesDir, 'frame-%05d.jpg'),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    ffmpeg.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

async function mkdtempCompat(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}