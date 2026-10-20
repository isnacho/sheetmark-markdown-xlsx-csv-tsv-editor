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

	// Spreadsheet webview: one IIFE bundle.
	const spreadsheetCtx = await esbuild.context({
		entryPoints: ['src/webviews/spreadsheet/spreadsheetWebview.ts'],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		platform: 'browser',
		outbase: 'src/webviews',
		outdir: 'dist',
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	// Markdown webview: an ES module with code splitting, so dynamic import()s (mermaid) become
	// separate chunks in dist/md/ that load on first use. Loaded with <script type="module">.
	const markdownCtx = await esbuild.context({
		entryPoints: ['src/webviews/md/mdWebview.ts'],
		bundle: true,
		format: 'esm',
		splitting: true,
		chunkNames: 'chunks/[name]-[hash]',
		minify: production,
		sourcemap: !production,
		platform: 'browser',
		outbase: 'src/webviews/md',
		outdir: 'dist/md',
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	const contexts = [extensionCtx, spreadsheetCtx, markdownCtx];

	if (watch) {
		await Promise.all(contexts.map(ctx => ctx.watch()));
	} else {
		// Start from an empty dist/: stale chunks or stray files would otherwise ship in the VSIX.
		require('fs').rmSync('dist', { recursive: true, force: true });
		await Promise.all(contexts.map(ctx => ctx.rebuild()));
		await Promise.all(contexts.map(ctx => ctx.dispose()));
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
