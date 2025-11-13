import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

describe('validate-chain', () => {
	const testDir = join(tmpdir(), 'esdb-test');
	const validBackup = `${testDir}/valid-backup.json`;
	const invalidBackup = `${testDir}/invalid-backup.json`;

	before(() => {
		mkdirSync(testDir, { recursive: true });

		// Create valid backup
		const validEvents = [
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
						data: { value: 'first' },
					},
					// biome-ignore lint/security/noSecrets: SHA-256 hash used for test data, not actual secrets
					hash: '72fe2f580855648230cc39bca73c91e35ba611fc497573abea105ff0c70484c8',
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
						// biome-ignore lint/security/noSecrets: SHA-256 hash used for test data, not actual secrets
						predecessorhash: '72fe2f580855648230cc39bca73c91e35ba611fc497573abea105ff0c70484c8',
						data: { value: 'second' },
					},
					// biome-ignore lint/security/noSecrets: SHA-256 hash used for test data, not actual secrets
					hash: 'db91d105b5b53da450cf569f06e26173084b5c14f3dc61a216f36a718a83b66f',
				},
			},
		];

		writeFileSync(validBackup, validEvents.map(e => JSON.stringify(e)).join('\n'));

		// Create invalid backup (wrong predecessor hash)
		const invalidEvents = [
			validEvents[0],
			{
				type: 'event',
				payload: {
					event: {
						...validEvents[1].payload.event,
						predecessorhash: 'wrong_hash',
					},
					hash: validEvents[1].payload.hash,
				},
			},
		];

		writeFileSync(invalidBackup, invalidEvents.map(e => JSON.stringify(e)).join('\n'));
	});

	it('validates a correct chain', () => {
		const output = execSync(`npx tsx ./src/index.ts validate-chain ${validBackup}`, {
			encoding: 'utf-8',
		});
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /✓ Chain is valid \(2 events\)/);
	});

	it('detects chain validation errors', () => {
		assert.throws(
			() => {
				execSync(`npx tsx ./src/index.ts validate-chain ${invalidBackup}`, {
					encoding: 'utf-8',
				});
			},
			(error: Error & { stdout?: string }) => {
				const output = error.stdout || '';
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /✗ Chain validation failed/);
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /Predecessor hash mismatch/);
				return true;
			},
		);
	});

	it('handles missing file gracefully', () => {
		assert.throws(
			() => {
				execSync('npx tsx ./src/index.ts validate-chain /nonexistent/file.json', {
					encoding: 'utf-8',
				});
			},
			(error: Error & { stdout?: string }) => {
				const output = error.stdout || '';
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /✗ Failed to validate chain/);
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /File not found/);
				return true;
			},
		);
	});

	it('shows error when file argument is missing', () => {
		try {
			execSync('npx tsx ./src/index.ts validate-chain', {
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
