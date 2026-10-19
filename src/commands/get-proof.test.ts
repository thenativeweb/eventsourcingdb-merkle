import assert from 'node:assert';
import { execFileSync, execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

// Stored hashes of version 1, in the form in which EventSourcingDB stores them.
const firstHash = 'a1'.repeat(32);
const secondHash = 'b2'.repeat(32);

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
					hash: firstHash,
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
						predecessorhash: firstHash,
						data: { value: 'test2' },
					},
					hash: secondHash,
				},
			},
		];

		writeFileSync(testBackup, events.map(e => JSON.stringify(e)).join('\n'));
	});

	it('generates proof for event', () => {
		const output = execSync(`node ./dist/index.js get-proof --backup=${testBackup} --event-id=0`, {
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
		const output = execSync(
			`node ./dist/index.js get-proof --backup=${testBackup} --event-id=0 --json`,
			{
				encoding: 'utf-8',
			},
		);
		const parsed = JSON.parse(output.trim());
		assert.strictEqual(parsed.eventId, '0');
		assert.ok(parsed.eventHash);
		assert.ok(parsed.merkleRoot);
		assert.ok(Array.isArray(parsed.siblingHashes));
	});

	it('handles non-existent event ID', () => {
		assert.throws(
			() => {
				execSync(`node ./dist/index.js get-proof --backup=${testBackup} --event-id=999`, {
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

	it('shows error when the backup is missing', () => {
		try {
			execSync('node ./dist/index.js get-proof', {
				encoding: 'utf-8',
			});
			assert.fail('Expected command to fail');
		} catch (error: unknown) {
			const err = error as Error & { stdout?: string; status?: number };
			assert.strictEqual(
				err.stdout,
				'✗ Either --backup or --esdb-url must be provided\nSee more help with --help\n',
			);
			assert.strictEqual(err.status, 2);
		}
	});

	describe('with a last event ID', () => {
		const backup = '--backup=test-fixtures/backup-with-both-hash-versions.ndjson';
		const run = (command: string, args: string[]): { output: string; exitCode: number } => {
			try {
				return {
					output: execFileSync('node', ['./dist/index.js', command, ...args], {
						encoding: 'utf-8',
					}),
					exitCode: 0,
				};
			} catch (error: unknown) {
				const { stdout, status } = error as { stdout: string; status: number };
				return { output: stdout, exitCode: status };
			}
		};

		it('proves an event against the root up to the last event ID', () => {
			const root = run('merkle-root', [backup, '--last-event-id=1']).output.split('\n')[0];
			const { output, exitCode } = run('get-proof', [
				backup,
				'--event-id=0',
				'--last-event-id=1',
				'--json',
			]);
			assert.strictEqual(exitCode, 0, output);
			const proof = JSON.parse(output) as { merkleRoot: string };

			assert.strictEqual(`Merkle Root: ${proof.merkleRoot}`, root);
			assert.strictEqual(run('verify-proof', [output]).exitCode, 0);
		});

		it('takes an event ID in another notation of the same number, as EventSourcingDB does', () => {
			const { output, exitCode } = run('get-proof', [
				backup,
				'--event-id=01',
				'--last-event-id=1',
				'--json',
			]);

			assert.strictEqual(exitCode, 0, output);
			assert.strictEqual((JSON.parse(output) as { eventId: string }).eventId, '1');
		});

		it('refuses a last event ID that is no event ID', () => {
			const { output, exitCode } = run('get-proof', [
				backup,
				'--event-id=0',
				'--last-event-id=abc',
			]);

			assert.strictEqual(exitCode, 2);
			assert.strictEqual(
				output,
				"✗ --last-event-id has to be an event ID, but is 'abc'\nSee more help with --help\n",
			);
		});

		it('refuses an event beyond the last event ID', () => {
			const { output, exitCode } = run('get-proof', [backup, '--event-id=3', '--last-event-id=1']);

			assert.strictEqual(exitCode, 1);
			assert.strictEqual(output, '✗ Event 3 lies beyond the last event ID 1\n');
		});

		it('refuses a last event ID that the backup does not hold', () => {
			const { output, exitCode } = run('get-proof', [backup, '--event-id=0', '--last-event-id=9']);

			assert.strictEqual(exitCode, 1);
			assert.strictEqual(
				output,
				'✗ Failed to generate Merkle proof: the backup holds no event with ID 9\n',
			);
		});

		it('shows error when the event ID is missing', () => {
			const { output, exitCode } = run('get-proof', [backup]);

			assert.strictEqual(exitCode, 2);
			assert.strictEqual(
				output,
				'✗ --event-id is required when using --backup or --esdb-url\nSee more help with --help\n',
			);
		});
	});

	describe('in either version of the tree', () => {
		const backup = '--backup=test-fixtures/backup-with-both-hash-versions.ndjson';
		const keyDigits = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
		const keyFile = join(mkdtempSync(join(tmpdir(), 'esdb-merkle-')), 'merkle.key');
		writeFileSync(keyFile, `${keyDigits}\n`);

		const run = (command: string, args: string[]): { output: string; exitCode: number } => {
			try {
				return {
					output: execFileSync('node', ['./dist/index.js', command, ...args], {
						encoding: 'utf-8',
					}),
					exitCode: 0,
				};
			} catch (error: unknown) {
				const { stdout, status } = error as { stdout: string; status: number };
				return { output: stdout, exitCode: status };
			}
		};

		interface Proof {
			eventId: string;
			eventHash: string;
			salt?: string;
			siblingHashes: { hash: string; position: string }[];
			merkleRoot: string;
		}

		const formatProof = (proof: Proof): string =>
			[
				`Merkle Proof for Event ${proof.eventId}`,
				'',
				`Event Hash: ${proof.eventHash}`,
				...(proof.salt === undefined ? [] : [`Salt: ${proof.salt}`]),
				`Merkle Root: ${proof.merkleRoot}`,
				'',
				`Sibling Hashes (${proof.siblingHashes.length}):`,
				...proof.siblingHashes.map(
					({ hash, position }, index) => `  ${index + 1}. ${hash} (${position})`,
				),
				'',
			].join('\n');

		it('proves an event with its salt against the root that the same key salted', () => {
			const salted = [backup, `--salt-key-file=${keyFile}`];
			const root = run('merkle-root', salted).output.split('\n')[0];
			const { output, exitCode } = run('get-proof', [...salted, '--event-id=2', '--json']);
			assert.strictEqual(exitCode, 0, output);
			const proof = JSON.parse(output) as Proof;
			const storedHashes = readFileSync(
				'test-fixtures/backup-with-both-hash-versions.ndjson',
				'utf-8',
			)
				.trimEnd()
				.split('\n')
				.map(line => JSON.parse(line) as { type: string; payload: { hash?: string } })
				.filter(line => line.type === 'event')
				.map(line => line.payload.hash);

			assert.strictEqual(proof.eventId, '2');
			assert.strictEqual(proof.eventHash, storedHashes[2]);
			assert.deepStrictEqual(Object.keys(proof), [
				'eventId',
				'eventHash',
				'salt',
				'siblingHashes',
				'merkleRoot',
			]);
			assert.strictEqual(
				proof.salt,
				createHmac('sha256', Buffer.from(keyDigits, 'hex')).update(proof.eventHash).digest('hex'),
			);
			assert.strictEqual(`Merkle Root: ${proof.merkleRoot}`, root);
			assert.deepStrictEqual(run('verify-proof', [output]), {
				output: `✓ Merkle proof is valid\nEvent ID: 2\nEvent Hash: ${proof.eventHash}\nMerkle Root: ${proof.merkleRoot}\n`,
				exitCode: 0,
			});
		});

		it('shows the salt right after the hash of the event', () => {
			const salted = [backup, `--salt-key-file=${keyFile}`, '--event-id=2'];
			const proof = JSON.parse(run('get-proof', [...salted, '--json']).output) as Proof;

			assert.deepStrictEqual(run('get-proof', salted), { output: formatProof(proof), exitCode: 0 });
		});

		it('shows no salt where the leaves are not salted', () => {
			const proof = JSON.parse(
				run('get-proof', [backup, '--event-id=2', '--json']).output,
			) as Proof;

			assert.strictEqual(proof.salt, undefined);
			assert.deepStrictEqual(run('get-proof', [backup, '--event-id=2']), {
				output: formatProof(proof),
				exitCode: 0,
			});
		});

		it('proves an event against the root of version 1', () => {
			const root = run('merkle-root', [backup, '--tree-version=1']).output.split('\n')[0];
			const { output, exitCode } = run('get-proof', [
				backup,
				'--event-id=2',
				'--tree-version=1',
				'--json',
			]);
			assert.strictEqual(exitCode, 0, output);
			const proof = JSON.parse(output) as Proof;

			assert.strictEqual(proof.salt, undefined);
			assert.strictEqual(`Merkle Root: ${proof.merkleRoot}`, root);
			assert.strictEqual(run('verify-proof', [output]).exitCode, 0);
		});

		it('refuses a salt key file for the tree of version 1', () => {
			assert.deepStrictEqual(
				run('get-proof', [
					backup,
					'--event-id=2',
					'--tree-version=1',
					`--salt-key-file=${keyFile}`,
				]),
				{
					output:
						'✗ --salt-key-file and --tree-version=1 cannot be used together\nSee more help with --help\n',
					exitCode: 2,
				},
			);
		});

		it('reads the salt key before the source, and reports one that does not exist', () => {
			const missingKeyFile = join(tmpdir(), 'esdb-merkle-missing.key');

			assert.deepStrictEqual(
				run('get-proof', [
					'--backup=/nonexistent/file.json',
					'--event-id=2',
					`--salt-key-file=${missingKeyFile}`,
				]),
				{
					output: `✗ Failed to generate Merkle proof: File not found: ${missingKeyFile}\n`,
					exitCode: 1,
				},
			);
		});

		it('describes the flags of the tree in its help', () => {
			// The help wraps long descriptions, wherever the width of the terminal ends.
			const output = run('get-proof', ['--help']).output.replace(/\s+/gu, ' ');

			assert.ok(
				output.includes('File with the salt key to salt the leaves of the tree with'),
				output,
			);
			assert.ok(
				output.includes(
					'Version of the Merkle tree: 1 to prove against roots that releases before 3.0 calculated',
				),
				output,
			);
		});
	});

	describe('with a stored hash of no known form', () => {
		const brokenBackup = join(testDir, 'get-proof-broken-hash.json');

		before(() => {
			mkdirSync(testDir, { recursive: true });
			writeFileSync(
				brokenBackup,
				JSON.stringify({
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
				}),
			);
		});

		const runCommand = (args: string[]): { output: string; exitCode: number } => {
			try {
				return {
					output: execFileSync('node', ['./dist/index.js', 'get-proof', ...args], {
						encoding: 'utf-8',
					}),
					exitCode: 0,
				};
			} catch (error: unknown) {
				const { stdout, status } = error as { stdout: string; status: number };
				return { output: stdout, exitCode: status };
			}
		};

		it('refuses it in the tree of version 2, naming the event', () => {
			assert.deepStrictEqual(runCommand([`--backup=${brokenBackup}`, '--event-id=0']), {
				output: '✗ Failed to generate Merkle proof: event 0 has no hash of version 1 or 2\n',
				exitCode: 1,
			});
		});

		it('takes it in the tree of version 1, as releases before 3.0 did', () => {
			const { output, exitCode } = runCommand([
				`--backup=${brokenBackup}`,
				'--event-id=0',
				'--tree-version=1',
			]);

			assert.strictEqual(exitCode, 0, output);
		});
	});
});
