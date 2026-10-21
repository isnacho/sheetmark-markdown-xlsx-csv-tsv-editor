// Config for `npm run test:integration` (@vscode/test-cli): launches a real VS Code with this
// extension under development and runs the bundled mocha suites from out/integration/.
import { defineConfig } from '@vscode/test-cli';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A short, fresh user-data dir per run: VS Code puts its IPC socket there, and macOS rejects socket
// paths over ~104 characters (the default under .vscode-test/ is too long inside a git worktree).
const userDataDir = mkdtempSync(join(tmpdir(), 'smk-'));

export default defineConfig({
	files: 'out/integration/**/*.test.js',
	version: 'stable',
	launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', `--user-data-dir=${userDataDir}`],
	mocha: {
		ui: 'tdd',
		timeout: 60000,
	},
});
