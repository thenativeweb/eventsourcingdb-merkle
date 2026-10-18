import assert from 'node:assert';
import { execSync } from 'node:child_process';
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
		const output = execSync(`node ./dist/index.js merkle-root ${testBackup}`, {
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
				execSync('node ./dist/index.js merkle-root /nonexistent/file.json', {
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

	it('shows error when file argument is missing', () => {
		try {
			execSync('node ./dist/index.js merkle-root', {
				encoding: 'utf-8',
			});
			assert.fail('Expected command to fail');
		} catch (error: unknown) {
			const err = error as Error & { stdout?: string; stderr?: string };
			const output = err.stdout || '';
			// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
			assert.match(output, /Missing 1 required arg/);
		}
	});

	it('calculates the Merkle root of a backup of a store with a registered schema', () => {
		const output = execSync(
			'node ./dist/index.js merkle-root test-fixtures/backup-with-schema.ndjson',
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
});
