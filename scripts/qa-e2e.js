import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Own a direct Node child so Windows teardown does not depend on killing a shell tree.
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: '4174', NODE_ENV: 'production', DOTENV_CONFIG_PATH: 'qa-no-env', DATABASE_URL: '', TYPHOON_OCR_API_KEY: '', ADMIN_PASSWORD: '', ADMIN_SESSION_SECRET: '' },
  stdio: 'ignore',
});
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Isolated test server failed to start. Check port 4174.');
    try { ready = (await fetch('http://127.0.0.1:4174')).ok; if (ready) break; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!ready) throw new Error('Isolated test server did not start.');
  const runner = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, QA_EXTERNAL_SERVER: '1' },
  });
  const [code] = await once(runner, 'exit');
  process.exitCode = code ?? 1;
} finally {
  if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
}
