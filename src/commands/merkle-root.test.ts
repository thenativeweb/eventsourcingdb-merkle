import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
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
		const output = execSync(`npx tsx ./src/index.ts merkle-root ${testBackup}`, {
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
				execSync('npx tsx ./src/index.ts merkle-root /nonexistent/file.json', {
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
			execSync('npx tsx ./src/index.ts merkle-root', {
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
});
