import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';

const getGitVersion = () => {
  try {
    const commitRef = process.env.VERCEL_GIT_COMMIT_SHA || 'HEAD';
    const commitTime = execFileSync('git', ['show', '-s', '--format=%cI', commitRef], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const commitHash = execFileSync('git', ['rev-parse', '--short=7', commitRef], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return { commitTime, commitHash };
  } catch {
    return { commitTime: new Date().toISOString(), commitHash: 'build' };
  }
};

const { commitTime, commitHash } = getGitVersion();
const versionDate = new Date(commitTime);
const versionNumber = [
  String(versionDate.getUTCFullYear()).slice(-2),
  String(versionDate.getUTCMonth() + 1).padStart(2, '0'),
  String(versionDate.getUTCDate()).padStart(2, '0'),
  `${String(versionDate.getUTCHours()).padStart(2, '0')}${String(versionDate.getUTCMinutes()).padStart(2, '0')}`,
].join('.');

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(`v${versionNumber}.${commitHash}`),
    __APP_VERSION_TIME__: JSON.stringify(commitTime),
  },
});
