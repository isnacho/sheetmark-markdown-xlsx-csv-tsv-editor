const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const integration = process.argv.includes('--integration');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	if (integration) {
		// Integration tests (src/test/integration) run inside a VS Code extension host via @vscode/test-cli.
		// Clear stale bundles so a deleted test file doesn't keep running.
		require('fs').rmSync('out/integration', { recursive: true, force: true });
		await esbuild.build({
			entryPoints: ['src/test/integration/*.test.ts'],
			bundle: true,
			format: 'cjs',
			platform: 'node',
			sourcemap: true,
			outdir: 'out/integration',
			external: ['vscode', 'mocha'],
			logLevel: 'warning',
		});
		return;
	}

	const extensionCtx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});

	const webviewCtx = await esbuild.context({
		entryPoints: [
			'src/webviews/md/mdWebview.ts',
			'src/webviews/spreadsheet/spreadsheetWebview.ts'
		],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		platform: 'browser',
		outdir: 'dist',
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	if (watch) {
		await extensionCtx.watch();
		await webviewCtx.watch();
	} else {
		await extensionCtx.rebuild();
		await webviewCtx.rebuild();
		await extensionCtx.dispose();
		await webviewCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
