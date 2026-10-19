// Config for `npm run test:integration` (@vscode/test-cli): launches a real VS Code with this
// extension under development and runs the bundled mocha suites from out/integration/.
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/integration/**/*.test.js',
	version: 'stable',
	launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
	mocha: {
		ui: 'tdd',
		timeout: 60000,
	},
});
