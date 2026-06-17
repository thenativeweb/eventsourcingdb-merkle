import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['./src/index.ts', './src/commands/*.ts', './src/lib/*.ts'],
	format: 'esm',
	minify: true,
	outDir: './dist',
	clean: true,
	dts: false,
	// Emit `.js` (not `.mjs`) so the oclif `bin` and command discovery keep working.
	outExtensions: () => ({ js: '.js' }),
});
