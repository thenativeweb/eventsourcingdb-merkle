import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

describe('get-proof', () => {
	const testDir = join(tmpdir(), 'esdb-test');
	const testBackup = `${testDir}/proof-test.json`;

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

	it('generates proof for event', () => {
		const output = execSync(`npx tsx ./src/index.ts get-proof ${testBackup} 0`, {
			encoding: 'utf-8',
		});
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /Merkle Proof for Event 0/);
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /Event Hash:/);
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /Merkle Root:/);
	});

	it('outputs proof as JSON', () => {
		const output = execSync(`npx tsx ./src/index.ts get-proof ${testBackup} 0 --json`, {
			encoding: 'utf-8',
		});
		const parsed = JSON.parse(output.trim());
		assert.strictEqual(parsed.eventId, '0');
		assert.ok(parsed.eventHash);
		assert.ok(parsed.merkleRoot);
		assert.ok(Array.isArray(parsed.siblingHashes));
	});

	it('handles non-existent event ID', () => {
		assert.throws(
			() => {
				execSync(`npx tsx ./src/index.ts get-proof ${testBackup} 999`, {
					encoding: 'utf-8',
				});
			},
			(error: Error & { stdout?: string }) => {
				const output = error.stdout || '';
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /✗ Event with ID 999 not found/);
				return true;
			},
		);
	});

	it('shows error when arguments are missing', () => {
		try {
			execSync('npx tsx ./src/index.ts get-proof', {
				encoding: 'utf-8',
			});
			assert.fail('Expected command to fail');
		} catch (error: unknown) {
			const err = error as Error & { stdout?: string; stderr?: string };
			const output = err.stdout || '';
			// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
			assert.match(output, /Missing 2 required args/);
		}
	});
});
