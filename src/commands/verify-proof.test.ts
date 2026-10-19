import assert from 'node:assert';
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
		const output = execSync(`node ./dist/index.js verify-proof ${validProofFile}`, {
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
		const output = execSync(`node ./dist/index.js verify-proof '${proof}'`, {
			encoding: 'utf-8',
		});
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /✓ Merkle proof is valid/);
	});

	it('detects invalid proof', () => {
		assert.throws(
			() => {
				execSync(`node ./dist/index.js verify-proof ${invalidProofFile}`, {
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
				execSync(`node ./dist/index.js verify-proof '${invalidStructure}'`, {
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
			execSync('node ./dist/index.js verify-proof', {
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

	describe('in either version of the tree', () => {
		const run = (proofToVerify: unknown): { output: string; exitCode: number } => {
			try {
				return {
					output: execFileSync(
						'node',
						['./dist/index.js', 'verify-proof', JSON.stringify(proofToVerify)],
						{
							encoding: 'utf-8',
						},
					),
					exitCode: 0,
				};
			} catch (error: unknown) {
				const { stdout, status } = error as { stdout: string; status: number };
				return { output: stdout, exitCode: status };
			}
		};

		// A proof of version 2 over a tree of a single, salted leaf, whose root is
		// the hash of that leaf.
		const salt = '1010101010101010101010101010101010101010101010101010101010101010';
		const proof = {
			eventId: '0',
			eventHash: 'abc123',
			salt,
			siblingHashes: [],
			merkleRoot: `esdb:merkle:v2:${createHash('sha256')
				.update(Buffer.from([0x00]))
				.update(Buffer.from(salt, 'hex'))
				.update('abc123')
				.digest('hex')}`,
		};

		it('verifies a proof of version 2 with its salt', () => {
			assert.deepStrictEqual(run(proof), {
				output: `✓ Merkle proof is valid\nEvent ID: 0\nEvent Hash: abc123\nMerkle Root: ${proof.merkleRoot}\n`,
				exitCode: 0,
			});
		});

		it('rejects a proof of version 2 with another salt', () => {
			assert.deepStrictEqual(run({ ...proof, salt: '11'.repeat(32) }), {
				output: `✗ Merkle proof is invalid\nEvent ID: 0\nEvent Hash: abc123\nMerkle Root: ${proof.merkleRoot}\n`,
				exitCode: 1,
			});
		});

		it('refuses a salt that is not 64 hexadecimal digits', () => {
			assert.deepStrictEqual(run({ ...proof, salt: salt.slice(1) }), {
				output: '✗ Invalid proof structure\nThe salt has to be 64 hexadecimal digits\n',
				exitCode: 1,
			});
		});

		it('refuses a salt in a proof of version 1', () => {
			assert.deepStrictEqual(run({ ...proof, merkleRoot: 'abc123' }), {
				output: '✗ Invalid proof structure\nA proof of Merkle tree version 1 has no salt\n',
				exitCode: 1,
			});
		});

		it('refuses a root of a version of the tree that it does not know', () => {
			assert.deepStrictEqual(run({ ...proof, merkleRoot: 'esdb:merkle:v3:abc' }), {
				output: '✗ Failed to verify Merkle proof: Unsupported Merkle tree version: v3\n',
				exitCode: 1,
			});
		});
	});
});
