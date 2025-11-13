import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

describe('validate-event-hash', () => {
	const testDir = join(tmpdir(), 'esdb-test');
	const testBackup = `${testDir}/event-hash-test.json`;

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
					// biome-ignore lint/security/noSecrets: SHA-256 hash used for test data, not actual secrets
					hash: '4e09d3d2e20b15145060dadbbc8597c47508937819ec272b1d3b33f6e7d9d10b',
				},
			},
		];

		writeFileSync(testBackup, events.map(e => JSON.stringify(e)).join('\n'));
	});

	it('validates event hash from file', () => {
		const output = execSync(
			`npx tsx ./src/index.ts validate-event-hash --file ${testBackup} --event-id 0`,
			{ encoding: 'utf-8' },
		);
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /✓ Hash is valid/);
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /Event ID: 0/);
	});

	it('handles non-existent event ID', () => {
		assert.throws(
			() => {
				execSync(`npx tsx ./src/index.ts validate-event-hash --file ${testBackup} --event-id 999`, {
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

	it('calculates hash for CloudEvent without stored hash', () => {
		const event = JSON.stringify({
			specversion: '1.0',
			id: '0',
			time: '2024-01-01T00:00:00Z',
			source: 'test',
			subject: '/test',
			type: 'test.event',
			datacontenttype: 'application/json',
			predecessorhash: '0'.repeat(64),
			data: { value: 'test' },
		});
		const output = execSync(`npx tsx ./src/index.ts validate-event-hash --event '${event}'`, {
			encoding: 'utf-8',
		});
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /Calculated hash:/);
	});

	it('shows error when event-id is missing with file', () => {
		assert.throws(
			() => {
				execSync(`npx tsx ./src/index.ts validate-event-hash --file ${testBackup}`, {
					encoding: 'utf-8',
				});
			},
			(error: Error & { stdout?: string }) => {
				const output = error.stdout || '';
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /✗ --event-id is required when using --file/);
				return true;
			},
		);
	});

	it('shows error when no arguments provided', () => {
		assert.throws(
			() => {
				execSync('npx tsx ./src/index.ts validate-event-hash', {
					encoding: 'utf-8',
				});
			},
			(error: Error & { stdout?: string }) => {
				const output = error.stdout || '';
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /✗ Either --file and --event-id, or --event must be provided/);
				return true;
			},
		);
	});
});
