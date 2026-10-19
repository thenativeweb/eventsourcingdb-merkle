import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const saltKeyFilePattern = /^[0-9a-f]{64}\n$/u;

const run = (args: string[]): { output: string; exitCode: number } => {
	try {
		return {
			output: execFileSync('node', ['./dist/index.js', ...args], { encoding: 'utf-8' }),
			exitCode: 0,
		};
	} catch (error: unknown) {
		const { stdout, status } = error as { stdout: string; status: number };
		return { output: stdout, exitCode: status };
	}
};

const getTemporaryPath = (name: string): string =>
	join(mkdtempSync(join(tmpdir(), 'esdb-merkle-')), name);

describe('generate-salt-key', () => {
	it('writes a salt key, and reminds to keep it safe', () => {
		const keyFile = getTemporaryPath('merkle.key');

		assert.deepStrictEqual(run(['generate-salt-key', `--output=${keyFile}`]), {
			output: `✓ Salt key written to ${keyFile}\nKeep it safe: without it, no further proof can be generated for a root calculated with it.\n`,
			exitCode: 0,
		});
		assert.match(readFileSync(keyFile, 'utf-8'), saltKeyFilePattern);
	});

	// Windows knows no such permissions, only whether a file is read-only.
	it('lets only the owner read the salt key, and nobody write it', {
		skip: process.platform === 'win32',
	}, () => {
		const keyFile = getTemporaryPath('merkle.key');

		run(['generate-salt-key', `--output=${keyFile}`]);

		// The permissions are the lowest nine bits of the mode.
		assert.strictEqual(statSync(keyFile).mode % 0o1000, 0o400);
	});

	it('writes a salt key that salts a root and its proofs', () => {
		const keyFile = getTemporaryPath('merkle.key');
		run(['generate-salt-key', `--output=${keyFile}`]);
		const salted = [
			'--backup=test-fixtures/backup-with-both-hash-versions.ndjson',
			`--salt-key-file=${keyFile}`,
		];

		const root = run(['merkle-root', ...salted]);
		const proof = run(['get-proof', ...salted, '--event-id=1', '--json']);

		assert.strictEqual(root.exitCode, 0, root.output);
		assert.strictEqual(proof.exitCode, 0, proof.output);
		assert.strictEqual(
			`Merkle Root: ${(JSON.parse(proof.output) as { merkleRoot: string }).merkleRoot}`,
			root.output.split('\n')[0],
		);
		assert.strictEqual(run(['verify-proof', proof.output]).exitCode, 0);
	});

	it('never overwrites a file', () => {
		const keyFile = getTemporaryPath('merkle.key');
		writeFileSync(keyFile, 'the key that salted a published root\n');

		assert.deepStrictEqual(run(['generate-salt-key', `--output=${keyFile}`]), {
			output: `✗ Failed to generate salt key: ${keyFile} already exists\n`,
			exitCode: 1,
		});
		assert.strictEqual(readFileSync(keyFile, 'utf-8'), 'the key that salted a published root\n');
	});

	it('names the reason why it could not write the salt key', () => {
		const keyFile = join(getTemporaryPath('missing'), 'merkle.key');

		assert.deepStrictEqual(run(['generate-salt-key', `--output=${keyFile}`]), {
			output: `✗ Failed to generate salt key: ENOENT: no such file or directory, open '${keyFile}'\n`,
			exitCode: 1,
		});
	});

	it('refuses a call without an output file', () => {
		assert.deepStrictEqual(run(['generate-salt-key']), {
			output:
				'✗ The following error occurred:\n  Missing required flag output\nSee more help with --help\n',
			exitCode: 2,
		});
	});

	it('describes itself and its flag in its help', () => {
		// The help wraps long descriptions, wherever the width of the terminal ends.
		const output = run(['generate-salt-key', '--help']).output.replace(/\s+/gu, ' ');

		assert.ok(output.includes('Generate a key to salt the leaves of Merkle trees with'), output);
		assert.ok(
			output.includes('File to write the salt key to; an existing file is never overwritten'),
			output,
		);
	});
});
