import assert from 'node:assert';
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

describe('merkle-root', () => {
	const testDir = join(tmpdir(), 'esdb-test');
	const testBackup = `${testDir}/merkle-test.json`;

	before(() => {
		mkdirSync(testDir, { recursive: true });

		const events = [
			{
				type: 'event',
				payload: {
					event: {
						specversion: '1.0',
						id: '0',
						time: '2024-01-01T00:00:00Z',
						source: 'test',
						subject: '/test/0',
						type: 'test.event',
						datacontenttype: 'application/json',
						predecessorhash: '0'.repeat(64),
						data: { value: 'test' },
					},
					hash: 'abc123',
				},
			},
			{
				type: 'event',
				payload: {
					event: {
						specversion: '1.0',
						id: '1',
						time: '2024-01-01T00:01:00Z',
						source: 'test',
						subject: '/test/1',
						type: 'test.event',
						datacontenttype: 'application/json',
						predecessorhash: 'abc123',
						data: { value: 'test2' },
					},
					hash: 'def456',
				},
			},
		];

		writeFileSync(testBackup, events.map(e => JSON.stringify(e)).join('\n'));
	});

	it('calculates and displays merkle root', () => {
		const output = execSync(`node ./dist/index.js merkle-root --backup=${testBackup}`, {
			encoding: 'utf-8',
		});
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /Merkle Root:/);
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /Total events: 2/);
	});

	it('handles missing file gracefully', () => {
		assert.throws(
			() => {
				execSync('node ./dist/index.js merkle-root --backup=/nonexistent/file.json', {
					encoding: 'utf-8',
				});
			},
			(error: Error & { stdout?: string }) => {
				const output = error.stdout || '';
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /✗ Failed to calculate Merkle root/);
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /File not found/);
				return true;
			},
		);
	});

	it('shows error when the backup is missing', () => {
		try {
			execSync('node ./dist/index.js merkle-root', {
				encoding: 'utf-8',
			});
			assert.fail('Expected command to fail');
		} catch (error: unknown) {
			const err = error as Error & { stdout?: string; status?: number };
			assert.strictEqual(err.stdout, '✗ --backup must be provided\nSee more help with --help\n');
			assert.strictEqual(err.status, 2);
		}
	});

	it('calculates the Merkle root of a backup of a store with a registered schema', () => {
		const output = execSync(
			'node ./dist/index.js merkle-root --backup=test-fixtures/backup-with-schema.ndjson',
			{ encoding: 'utf-8' },
		);
		const [firstHash, secondHash] = readFileSync('test-fixtures/backup-with-schema.ndjson', 'utf-8')
			.trimEnd()
			.split('\n')
			.map(line => JSON.parse(line) as { type: string; payload: { hash?: string } })
			.filter(line => line.type === 'event')
			.map(line => line.payload.hash);
		const expectedRoot = createHash('sha256').update(`${firstHash}${secondHash}`).digest('hex');

		assert.match(output, new RegExp(`Merkle Root: ${expectedRoot}`));
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /Total events: 2/);
	});

	it('builds the Merkle tree from the hashes as they are stored, of either version', () => {
		const output = execSync(
			'node ./dist/index.js merkle-root --backup=test-fixtures/backup-with-both-hash-versions.ndjson',
			{ encoding: 'utf-8' },
		);

		const hashes = readFileSync('test-fixtures/backup-with-both-hash-versions.ndjson', 'utf-8')
			.trimEnd()
			.split('\n')
			.map(line => JSON.parse(line) as { type: string; payload: { hash?: string } })
			.filter(line => line.type === 'event')
			.map(line => line.payload.hash ?? '');
		assert.strictEqual(hashes.length, 4);
		const [first, second, third, fourth] = hashes;
		const pair = (left?: string, right?: string): string =>
			createHash('sha256').update(`${left}${right}`).digest('hex');
		const expectedRoot = pair(pair(first, second), pair(third, fourth));

		assert.strictEqual(output, `Merkle Root: ${expectedRoot}\nTotal events: 4\nLast event ID: 3\n`);
	});

	describe('with a last event ID', () => {
		const run = (args: string[]): { output: string; exitCode: number } => {
			try {
				return {
					output: execFileSync('node', ['./dist/index.js', 'merkle-root', ...args], {
						encoding: 'utf-8',
					}),
					exitCode: 0,
				};
			} catch (error: unknown) {
				const { stdout, status } = error as { stdout: string; status: number };
				return { output: stdout, exitCode: status };
			}
		};

		// The older backup holds the first two events of the newer one, which
		// EventSourcingDB wrote before it wrote the others.
		it('calculates the root of an older backup again from a newer one', () => {
			const older = run(['--backup=test-fixtures/backup-before-version-2.ndjson']);
			const newer = run([
				'--backup=test-fixtures/backup-with-both-hash-versions.ndjson',
				'--last-event-id=1',
			]);

			assert.strictEqual(older.exitCode, 0, older.output);
			// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
			const expectedOutput = /^Merkle Root: [0-9a-f]{64}\nTotal events: 2\nLast event ID: 1\n$/u;
			assert.match(older.output, expectedOutput);
			assert.strictEqual(newer.output, older.output);
		});

		it('refuses a last event ID that the backup does not hold', () => {
			const { output, exitCode } = run([
				'--backup=test-fixtures/backup-with-both-hash-versions.ndjson',
				'--last-event-id=9',
			]);

			assert.strictEqual(exitCode, 1);
			assert.strictEqual(
				output,
				'✗ Failed to calculate Merkle root: the backup holds no event with ID 9\n',
			);
		});
	});
});
