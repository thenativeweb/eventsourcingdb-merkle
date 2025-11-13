import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

describe('verify-proof', () => {
	const testDir = join(tmpdir(), 'esdb-test');
	const validProofFile = `${testDir}/valid-proof.json`;
	const invalidProofFile = `${testDir}/invalid-proof.json`;

	before(() => {
		mkdirSync(testDir, { recursive: true });

		// Valid proof (single element, no siblings needed)
		const validProof = {
			eventId: '0',
			eventHash: 'abc123',
			siblingHashes: [],
			merkleRoot: 'abc123',
		};

		// Invalid proof (hash doesn't match root)
		const invalidProof = {
			eventId: '0',
			eventHash: 'abc123',
			siblingHashes: [],
			merkleRoot: 'wrong_root',
		};

		writeFileSync(validProofFile, JSON.stringify(validProof));
		writeFileSync(invalidProofFile, JSON.stringify(invalidProof));
	});

	it('verifies valid proof from file', () => {
		const output = execSync(`npx tsx ./src/index.ts verify-proof ${validProofFile}`, {
			encoding: 'utf-8',
		});
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /✓ Merkle proof is valid/);
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /Event ID: 0/);
	});

	it('verifies valid proof from JSON string', () => {
		const proof = JSON.stringify({
			eventId: '0',
			eventHash: 'test123',
			siblingHashes: [],
			merkleRoot: 'test123',
		});
		const output = execSync(`npx tsx ./src/index.ts verify-proof '${proof}'`, {
			encoding: 'utf-8',
		});
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /✓ Merkle proof is valid/);
	});

	it('detects invalid proof', () => {
		assert.throws(
			() => {
				execSync(`npx tsx ./src/index.ts verify-proof ${invalidProofFile}`, {
					encoding: 'utf-8',
				});
			},
			(error: Error & { stdout?: string }) => {
				const output = error.stdout || '';
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /✗ Merkle proof is invalid/);
				return true;
			},
		);
	});

	it('rejects proof with invalid structure', () => {
		const invalidStructure = JSON.stringify({ invalid: 'structure' });
		assert.throws(
			() => {
				execSync(`npx tsx ./src/index.ts verify-proof '${invalidStructure}'`, {
					encoding: 'utf-8',
				});
			},
			(error: Error & { stdout?: string }) => {
				const output = error.stdout || '';
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /✗ Invalid proof structure/);
				return true;
			},
		);
	});

	it('shows error when proof argument is missing', () => {
		try {
			execSync('npx tsx ./src/index.ts verify-proof', {
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
