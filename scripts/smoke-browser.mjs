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
    const byTitle = (title) => document.querySelector(`[title="${title}"]`);
    const visibleCanvasMetrics = () => {
      const canvas = document.querySelector('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) {
        return { ok: false, width: 0, height: 0 };
      }
      const rect = canvas.getBoundingClientRect();
      return { ok: rect.width > 200 && rect.height > 200 && canvas.width > 200 && canvas.height > 200, width: rect.width, height: rect.height, bufferWidth: canvas.width, bufferHeight: canvas.height };
    };
    const hasCanvas = Boolean(document.querySelector('canvas'));
    const canvasVisible = visibleCanvasMetrics();
    const hasSample = Boolean(byText('Blue titanium fan stage'));
    const timelineTypes = () => [...document.querySelectorAll('.history-row strong')].map((item) => item.textContent?.trim()).filter(Boolean);
    const timelineDetails = () => [...document.querySelectorAll('.history-row em')].map((item) => item.textContent?.trim()).filter(Boolean);
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
    const hasStatus = Boolean(byText('已旋转 30 度'));
    const rotationSkippedTimeline = !timelineTypes().includes('rotateMesh');

    const workspaceSelect = document.querySelector('.workspace-select select');
    if (!(workspaceSelect instanceof HTMLSelectElement)) {
      throw new Error('Workspace select not found');
    }
    workspaceSelect.value = 'robotic-cell';
    workspaceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const hasRobotSample = Boolean(byText('Robot base turntable'));
    const robotCanvasVisible = visibleCanvasMetrics();

    const selectButton = (name) => [...document.querySelectorAll('.object-select-button')].find((button) => button.textContent?.includes(name));
    selectButton('Robot base turntable')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    selectButton('Robot shoulder joint')?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    const selectedRows = document.querySelectorAll('.object-row.selected').length;
    const rotateButton = byTitle('拖拽旋转所选对象');
    rotateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    const rotateCapture = document.querySelector('.object-rotate-capture');
    const captureRect = rotateCapture?.getBoundingClientRect();
    if (rotateCapture && captureRect) {
      rotateCapture.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: captureRect.left + 220, clientY: captureRect.top + 180 }));
      rotateCapture.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, button: 0, clientX: captureRect.left + 280, clientY: captureRect.top + 140 }));
      rotateCapture.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, clientX: captureRect.left + 280, clientY: captureRect.top + 140 }));
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    const dragRotateAvailable = Boolean(rotateCapture);
    const dragRotateSkippedTimeline = !timelineDetails().includes('viewport drag rotate');

    byTitle('隐藏左侧对象树')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    byTitle('隐藏右侧检查器')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    byTitle('隐藏底部时间线')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const panelsHidden = !document.querySelector('.left-panel') && !document.querySelector('.right-panel') && !document.querySelector('.history-panel');
    const restoreButton = (text) => [...document.querySelectorAll('.restore-panel-button')].find((button) => button.textContent?.includes(text));
    const restoreButtonsVisible = Boolean(restoreButton('对象树') && restoreButton('检查器') && restoreButton('时间线'));

    restoreButton('对象树')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    restoreButton('检查器')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    restoreButton('时间线')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const restoredFromCanvas = Boolean(document.querySelector('.left-panel') && document.querySelector('.right-panel') && document.querySelector('.history-panel'));
    const workbenchRect = document.querySelector('.workbench-grid')?.getBoundingClientRect();
    const leftRect = document.querySelector('.left-panel-slot')?.getBoundingClientRect();
    const rightRect = document.querySelector('.right-panel-slot')?.getBoundingClientRect();
    const bottomRect = document.querySelector('.bottom-panel-slot')?.getBoundingClientRect();
    const layoutRectsAligned = Boolean(
      workbenchRect
      && leftRect
      && rightRect
      && bottomRect
      && Math.abs(leftRect.top - workbenchRect.top) < 1
      && Math.abs(leftRect.bottom - workbenchRect.bottom) < 1
      && Math.abs(rightRect.top - workbenchRect.top) < 1
      && Math.abs(rightRect.bottom - workbenchRect.bottom) < 1
      && bottomRect.left >= leftRect.right - 1
      && bottomRect.right <= rightRect.left + 1
      && Math.abs(bottomRect.bottom - workbenchRect.bottom) < 1
    );

    const leftPanelSlot = document.querySelector('.left-panel-slot');
    const leftResizeHandle = document.querySelector('.left-panel-slot .resize-handle-right');
    const beforeResizeWidth = leftPanelSlot?.getBoundingClientRect().width ?? 0;
    leftResizeHandle?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: beforeResizeWidth, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: beforeResizeWidth - 34, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: beforeResizeWidth - 34, clientY: 120 }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    const afterResizeWidth = leftPanelSlot?.getBoundingClientRect().width ?? 0;
    const resizedLeftPanel = afterResizeWidth < beforeResizeWidth - 10;

    const operationsTab = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('操作'));
    operationsTab?.click();
    await new Promise((resolve) => setTimeout(resolve, 60));

    const viewScaleSelect = document.querySelector('.view-scale-control select[aria-label="视图比例"]');
    if (!(viewScaleSelect instanceof HTMLSelectElement)) {
      throw new Error('View scale select not found');
    }
    const viewScaleSlider = document.querySelector('.view-scale-control input[aria-label="视图比例滑杆"]');
    if (!(viewScaleSlider instanceof HTMLInputElement)) {
      throw new Error('View scale slider not found');
    }
    const scaleOptionLabels = [...viewScaleSelect.options].map((option) => option.textContent?.trim());
    const initialScaleMidpoint = viewScaleSlider.value === '50' && viewScaleSelect.value === '1' && viewScaleSelect.selectedOptions[0]?.textContent === '100%';
    const scaleRangeBounded = scaleOptionLabels.includes('20%') && scaleOptionLabels.includes('200%') && scaleOptionLabels.includes('250%') && scaleOptionLabels.includes('300%') && scaleOptionLabels.includes('400%');

    const rangeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    rangeValueSetter?.call(viewScaleSlider, '73');
    viewScaleSlider.dispatchEvent(new Event('input', { bubbles: true }));
    viewScaleSlider.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const customScaleUpdatesNumber = viewScaleSelect.selectedOptions[0]?.textContent === '238%' && viewScaleSlider.value === '73';

    viewScaleSelect.value = '4';
    viewScaleSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const hasViewScaleStatus = viewScaleSelect.value === '4' && viewScaleSelect.selectedOptions[0]?.textContent === '400%' && viewScaleSlider.value === '100';
    const viewScaleSkippedTimeline = !timelineDetails().includes('150%');
    const viewScaleInViewport = Boolean(document.querySelector('.viewer-panel .view-scale-control'));
    const viewScaleInInspector = Boolean(document.querySelector('.right-panel input[aria-label="视图比例"]'));
    const objectScaleRemoved = !document.querySelector('input[aria-label="缩放比例"]') && ![...document.querySelectorAll('button')].some((button) => button.textContent?.includes('应用缩放'));

    byTitle('显示左侧对象树')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    byTitle('显示右侧检查器')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    byTitle('显示底部时间线')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const panelsRestored = Boolean(document.querySelector('.left-panel') && document.querySelector('.right-panel') && document.querySelector('.history-panel'));

    return { hasCanvas, canvasVisible, hasSample, rotationSkippedTimeline, hasStatus, hasRobotSample, robotCanvasVisible, selectedRows, dragRotateAvailable, dragRotateSkippedTimeline, panelsHidden, restoreButtonsVisible, restoredFromCanvas, layoutRectsAligned, resizedLeftPanel, initialScaleMidpoint, scaleRangeBounded, customScaleUpdatesNumber, hasViewScaleStatus, viewScaleSkippedTimeline, viewScaleInViewport, viewScaleInInspector, objectScaleRemoved, panelsRestored };
  });

  if (
    !smokeResult.hasCanvas
    || !smokeResult.canvasVisible.ok
    || !smokeResult.hasSample
    || !smokeResult.rotationSkippedTimeline
    || !smokeResult.hasStatus
    || !smokeResult.hasRobotSample
    || !smokeResult.robotCanvasVisible.ok
    || smokeResult.selectedRows < 2
    || !smokeResult.dragRotateAvailable
    || !smokeResult.dragRotateSkippedTimeline
    || !smokeResult.panelsHidden
    || !smokeResult.restoreButtonsVisible
    || !smokeResult.restoredFromCanvas
    || !smokeResult.layoutRectsAligned
    || !smokeResult.resizedLeftPanel
    || !smokeResult.initialScaleMidpoint
    || !smokeResult.scaleRangeBounded
    || !smokeResult.customScaleUpdatesNumber
    || !smokeResult.hasViewScaleStatus
    || !smokeResult.viewScaleSkippedTimeline
    || !smokeResult.viewScaleInViewport
    || smokeResult.viewScaleInInspector
    || !smokeResult.objectScaleRemoved
    || !smokeResult.panelsRestored
  ) {
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
