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

	describe('in every version of the tree', () => {
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
		const eventHash = `esdb:hash:v2:${'ab'.repeat(32)}`;
		const proof = {
			eventId: '0',
			eventHash,
			salt,
			siblingHashes: [],
			merkleRoot: `esdb:merkle:v2:${createHash('sha256')
				.update(Buffer.from([0x00]))
				.update(Buffer.from(salt, 'hex'))
				.update(eventHash)
				.digest('hex')}`,
		};

		it('verifies a proof of version 2 with its salt', () => {
			assert.deepStrictEqual(run(proof), {
				output: `✓ Merkle proof is valid\nEvent ID: 0\nEvent Hash: ${eventHash}\nMerkle Root: ${proof.merkleRoot}\n`,
				exitCode: 0,
			});
		});

		it('rejects a proof of version 2 with another salt', () => {
			assert.deepStrictEqual(run({ ...proof, salt: '11'.repeat(32) }), {
				output: `✗ Merkle proof is invalid\nEvent ID: 0\nEvent Hash: ${eventHash}\nMerkle Root: ${proof.merkleRoot}\n`,
				exitCode: 1,
			});
		});

		it('refuses a salt that is not 64 hexadecimal digits', () => {
			assert.deepStrictEqual(run({ ...proof, salt: salt.slice(1) }), {
				output: '✗ Invalid proof structure\nThe salt has to be 64 hexadecimal digits\n',
				exitCode: 1,
			});
		});

		it('refuses an event hash that is no hash of version 1 or 2', () => {
			assert.deepStrictEqual(run({ ...proof, eventHash: 'abc123' }), {
				output: '✗ Invalid proof structure\nThe event hash has to be a hash of version 1 or 2\n',
				exitCode: 1,
			});
		});

		it('refuses a sibling that is no hash on one side', () => {
			assert.deepStrictEqual(
				run({ ...proof, siblingHashes: [{ hash: `${'ab'.repeat(32)}zz`, position: 'left' }] }),
				{
					output:
						'✗ Invalid proof structure\nEvery sibling has to have a hash of 64 hexadecimal digits, and the position left or right\n',
					exitCode: 1,
				},
			);
		});

		it('refuses a salt in a proof of version 1', () => {
			assert.deepStrictEqual(run({ ...proof, merkleRoot: 'abc123' }), {
				output: '✗ Invalid proof structure\nA proof of Merkle tree version 1 has no salt\n',
				exitCode: 1,
			});
		});

		it('refuses a root of a version of the tree that it does not know', () => {
			assert.deepStrictEqual(run({ ...proof, merkleRoot: 'esdb:merkle:v4:abc' }), {
				output: '✗ Failed to verify Merkle proof: Unsupported Merkle tree version: v4\n',
				exitCode: 1,
			});
		});

		it('refuses a last event ID in a proof of version 2', () => {
			assert.deepStrictEqual(run({ ...proof, lastEventId: '0' }), {
				output:
					'✗ Invalid proof structure\nA proof of Merkle tree version 2 has no last event ID\n',
				exitCode: 1,
			});
		});

		it('refuses a last event ID in a proof of version 1', () => {
			const { salt: _, ...unsalted } = proof;

			assert.deepStrictEqual(run({ ...unsalted, merkleRoot: 'abc123', lastEventId: '0' }), {
				output:
					'✗ Invalid proof structure\nA proof of Merkle tree version 1 has no last event ID\n',
				exitCode: 1,
			});
		});

		// A proof of version 3 over a tree of a single, salted leaf, whose root is
		// the hash of the size of the tree, as 8 bytes, and that leaf.
		const leafHash = createHash('sha256')
			.update(Buffer.from([0x00]))
			.update(Buffer.from(salt, 'hex'))
			.update(eventHash)
			.digest();
		const version3Proof = {
			eventId: '0',
			eventHash,
			salt,
			siblingHashes: [],
			merkleRoot: `esdb:merkle:v3:${createHash('sha256')
				.update(Buffer.from([0x02]))
				.update(Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]))
				.update(leafHash)
				.digest('hex')}`,
			lastEventId: '0',
		};
		const describeVersion3Proof = (eventId: string, lastEventId: string): string =>
			`Event ID: ${eventId}\nEvent Hash: ${eventHash}\nMerkle Root: ${version3Proof.merkleRoot}\nLast Event ID: ${lastEventId}\n`;

		it('verifies a proof of version 3, showing the ID of the last event', () => {
			assert.deepStrictEqual(run(version3Proof), {
				output: `✓ Merkle proof is valid\n${describeVersion3Proof('0', '0')}`,
				exitCode: 0,
			});
		});

		// The path of the second of two events leads to the root from the third of
		// three events as well, if its sibling is taken for the root of the first
		// two, so only the size that the root covers tells the two apart.
		it('rejects a proof of version 3 that names another event of a tree of another size', () => {
			const firstLeafHash = createHash('sha256')
				.update(Buffer.from([0x00]))
				.update(`esdb:hash:v2:${'cd'.repeat(32)}`)
				.digest();
			const secondLeafHash = createHash('sha256')
				.update(Buffer.from([0x00]))
				.update(eventHash)
				.digest();
			const proofOfSecondEvent = {
				eventId: '1',
				eventHash,
				siblingHashes: [firstLeafHash.toString('hex')],
				merkleRoot: `esdb:merkle:v3:${createHash('sha256')
					.update(Buffer.from([0x02]))
					.update(Buffer.from([0, 0, 0, 0, 0, 0, 0, 2]))
					.update(
						createHash('sha256')
							.update(Buffer.from([0x01]))
							.update(firstLeafHash)
							.update(secondLeafHash)
							.digest(),
					)
					.digest('hex')}`,
				lastEventId: '1',
			};
			const describeProofOfSecondEvent = (eventId: string, lastEventId: string): string =>
				`Event ID: ${eventId}\nEvent Hash: ${eventHash}\nMerkle Root: ${proofOfSecondEvent.merkleRoot}\nLast Event ID: ${lastEventId}\n`;

			assert.deepStrictEqual(run(proofOfSecondEvent), {
				output: `✓ Merkle proof is valid\n${describeProofOfSecondEvent('1', '1')}`,
				exitCode: 0,
			});
			assert.deepStrictEqual(run({ ...proofOfSecondEvent, eventId: '2', lastEventId: '2' }), {
				output: `✗ Merkle proof is invalid\n${describeProofOfSecondEvent('2', '2')}`,
				exitCode: 1,
			});
		});

		it('rejects a proof of version 3 of a tree larger than 8 bytes can count', () => {
			const lastEventId = String(2n ** 64n - 1n);

			assert.deepStrictEqual(
				run({
					...version3Proof,
					siblingHashes: Array.from({ length: 64 }, () => 'ab'.repeat(32)),
					lastEventId,
				}),
				{
					output: `✗ Merkle proof is invalid\n${describeVersion3Proof('0', lastEventId)}`,
					exitCode: 1,
				},
			);
		});

		it('rejects a proof of version 3 with an event beyond the last event ID', () => {
			assert.deepStrictEqual(run({ ...version3Proof, eventId: '1' }), {
				output: `✗ Merkle proof is invalid\n${describeVersion3Proof('1', '0')}`,
				exitCode: 1,
			});
		});

		for (const [name, tampered, problem] of [
			[
				'without a last event ID',
				{ ...version3Proof, lastEventId: undefined },
				'A proof of Merkle tree version 3 has to contain eventId and lastEventId',
			],
			[
				'with an event ID with a leading zero',
				{ ...version3Proof, eventId: '00' },
				'The event ID has to be digits alone, without a sign or leading zeros',
			],
			[
				'with a last event ID with a sign',
				{ ...version3Proof, lastEventId: '+0' },
				'The last event ID has to be digits alone, without a sign or leading zeros',
			],
			[
				'with a sibling with a side',
				{ ...version3Proof, siblingHashes: [{ hash: 'ab'.repeat(32), position: 'left' }] },
				'Every sibling has to be a hash of 64 hexadecimal digits',
			],
		] as const) {
			it(`refuses a proof of version 3 ${name}`, () => {
				assert.deepStrictEqual(run(tampered), {
					output: `✗ Invalid proof structure\n${problem}\n`,
					exitCode: 1,
				});
			});
		}
	});
});
