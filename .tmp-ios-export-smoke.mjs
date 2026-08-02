import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import sharp from 'sharp';

const cwd = process.cwd();
const port = 3148;
const debugPort = 9238;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn(process.execPath, ['server.js'], {
  cwd,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
  stdio: 'ignore',
});
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${cwd}\\.tmp-chrome-profile-2`,
  'about:blank',
], { stdio: 'ignore' });

async function waitFor(url, attempts = 80) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

let socket;
try {
  console.log('waiting: server');
  await waitFor(`http://localhost:${port}`);
  console.log('waiting: chrome');
  const targets = await (await waitFor(`http://localhost:${debugPort}/json/list`)).json();
  const target = targets.find((item) => item.type === 'page');
  console.log('connecting: devtools');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
    setTimeout(() => reject(new Error('DevTools WebSocket timeout')), 5000);
  });
  console.log('connected: devtools');

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, awaitPromise = true) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitForExpression = async (expression, attempts = 100) => {
    for (let index = 0; index < attempts; index += 1) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Timed out waiting for expression: ${expression}`);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
  });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ files }) => {
        const file = files[0];
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        window.__iosShareResult = { name: file.name, type: file.type, size: file.size, dataUrl };
      }});
    `,
  });
  await send('Page.navigate', { url: `http://localhost:${port}` });
  await waitForExpression(`document.querySelector('.hero-start-button') !== null`);
  console.log('loaded: app');

  const clickText = (selector, text) => evaluate(`
    (() => {
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((element) => element.textContent.includes(${JSON.stringify(text)}));
      if (!node) throw new Error('Missing button: ${text}');
      node.click();
      return true;
    })()
  `);
  const setInput = (selector, value) => evaluate(`
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()
  `);

  await evaluate(`document.querySelector('.hero-start-button').click()`);
  await waitForExpression(`document.querySelector('#event-name') !== null`);
  await setInput('#event-name', 'iOS Receipt Test');
  await clickText('button', 'OK, add friends');
  console.log('completed: event');

  for (const friend of ['Alice', 'Bob']) {
    await waitForExpression(`document.querySelector('#friend-name') !== null`);
    await setInput('#friend-name', friend);
    await clickText('button', 'Add');
  }
  await clickText('button', 'Continue to bill');
  console.log('completed: friends');
  await waitForExpression(`document.querySelector('.scan-start-options') !== null`);
  await clickText('button', 'Manual add');
  await waitForExpression(`document.querySelector('[aria-label="Food 1"]') !== null`);
  await setInput('[aria-label="Food 1"]', 'Very long Thai-style recipe item');
  await setInput('[aria-label="Quantity 1"]', '3');
  await setInput('[aria-label="Amount 1"]', '780');
  await clickText('button', 'Confirm & split');
  console.log('completed: bill');
  await waitForExpression(`document.querySelector('.select-all-button') !== null`);
  await clickText('button', 'Select all');
  await clickText('button', 'Calculate');
  console.log('completed: split');
  await waitForExpression(`document.querySelector('.result-step') !== null`);
  await clickText('button', 'Download as picture');
  console.log('clicked: download');
  await waitForExpression(`window.__iosShareResult?.dataUrl?.startsWith('data:image/png;base64,') === true`);

  const result = await evaluate(`window.__iosShareResult`);
  const png = Buffer.from(result.dataUrl.split(',')[1], 'base64');
  const outputPath = `${cwd}\\ios-receipt-test.png`;
  await writeFile(outputPath, png);
  const metadata = await sharp(png).metadata();
  console.log(JSON.stringify({
    iOSShareCalled: true,
    fileName: result.name,
    mimeType: result.type,
    bytes: result.size,
    width: metadata.width,
    height: metadata.height,
    outputPath,
  }, null, 2));
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  chrome.kill();
  server.kill();
}
