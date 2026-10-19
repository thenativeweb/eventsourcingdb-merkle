import assert from 'node:assert';
import { execFileSync, execSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

const sha256 = (...parts: (Buffer | string)[]): Buffer => {
	const hash = createHash('sha256');
	for (const part of parts) {
		hash.update(part);
	}

	return hash.digest();
};

// The leaves and inner nodes of the tree of version 2, calculated step by step
// as RFC 6962 defines them, with the salt that the key derives for a leaf.
const getLeaf = (storedHash: string, saltKey?: Buffer): Buffer =>
	sha256(
		Buffer.from([0x00]),
		saltKey === undefined
			? Buffer.alloc(0)
			: createHmac('sha256', saltKey).update(storedHash).digest(),
		storedHash,
	);
const getNode = (left: Buffer, right: Buffer): Buffer => sha256(Buffer.from([0x01]), left, right);
const formatRoot = (root: Buffer): string => `esdb:merkle:v2:${root.toString('hex')}`;

const readStoredHashes = (filePath: string): string[] =>
	readFileSync(filePath, 'utf-8')
		.trimEnd()
		.split('\n')
		.map(line => JSON.parse(line) as { type: string; payload: { hash?: string } })
		.filter(line => line.type === 'event')
		.map(line => line.payload.hash ?? '');

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

const twoEventsUpToEvent1 =
	/^Merkle Root: esdb:merkle:v2:[0-9a-f]{64}\nTotal events: 2\nLast event ID: 1\n$/u;

const keyDigits = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

const writeKeyFile = (text: string): string => {
	const filePath = join(mkdtempSync(join(tmpdir(), 'esdb-merkle-')), 'merkle.key');
	writeFileSync(filePath, text);

	return filePath;
};

// Stored hashes of version 1, in the form in which EventSourcingDB stores them.
const firstHash = 'a1'.repeat(32);
const secondHash = 'b2'.repeat(32);

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
			assert.strictEqual(
				err.stdout,
				'✗ Either --backup or --esdb-url must be provided\nSee more help with --help\n',
			);
			assert.strictEqual(err.status, 2);
		}
	});

	it('calculates the Merkle root of a backup of a store with a registered schema', () => {
		const output = execSync(
			'node ./dist/index.js merkle-root --backup=test-fixtures/backup-with-schema.ndjson',
			{ encoding: 'utf-8' },
		);
		const [firstStoredHash = '', secondStoredHash = ''] = readStoredHashes(
			'test-fixtures/backup-with-schema.ndjson',
		);
		const expectedRoot = formatRoot(getNode(getLeaf(firstStoredHash), getLeaf(secondStoredHash)));

		assert.match(output, new RegExp(`Merkle Root: ${expectedRoot}`));
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /Total events: 2/);
	});

	describe('in either version of the tree', () => {
		const backup = '--backup=test-fixtures/backup-with-both-hash-versions.ndjson';
		const hashes = readStoredHashes('test-fixtures/backup-with-both-hash-versions.ndjson');
		const [first = '', second = '', third = '', fourth = ''] = hashes;

		it('builds the tree of version 2 from the hashes as they are stored, of either version', () => {
			const expectedRoot = formatRoot(
				getNode(getNode(getLeaf(first), getLeaf(second)), getNode(getLeaf(third), getLeaf(fourth))),
			);

			assert.strictEqual(hashes.length, 4);
			assert.deepStrictEqual(run([backup]), {
				output: `Merkle Root: ${expectedRoot}\nTotal events: 4\nLast event ID: 3\n`,
				exitCode: 0,
			});
			assert.deepStrictEqual(run([backup, '--tree-version=2']), run([backup]));
		});

		it('salts the leaves with the key from the salt key file', () => {
			const saltKey = Buffer.from(keyDigits, 'hex');
			const expectedRoot = formatRoot(
				getNode(
					getNode(getLeaf(first, saltKey), getLeaf(second, saltKey)),
					getNode(getLeaf(third, saltKey), getLeaf(fourth, saltKey)),
				),
			);

			assert.deepStrictEqual(run([backup, `--salt-key-file=${writeKeyFile(`${keyDigits}\n`)}`]), {
				output: `Merkle Root: ${expectedRoot}\nTotal events: 4\nLast event ID: 3\n`,
				exitCode: 0,
			});
		});

		it('calculates the root of version 1 as releases before 3.0 did', () => {
			const pair = (left: string, right: string): string =>
				createHash('sha256').update(`${left}${right}`).digest('hex');
			const expectedRoot = pair(pair(first, second), pair(third, fourth));

			assert.deepStrictEqual(run([backup, '--tree-version=1']), {
				output: `Merkle Root: ${expectedRoot}\nTotal events: 4\nLast event ID: 3\n`,
				exitCode: 0,
			});
		});

		it('refuses a salt key file for the tree of version 1', () => {
			const keyFile = writeKeyFile(`${keyDigits}\n`);

			assert.deepStrictEqual(run([backup, '--tree-version=1', `--salt-key-file=${keyFile}`]), {
				output:
					'✗ --salt-key-file and --tree-version=1 cannot be used together\nSee more help with --help\n',
				exitCode: 2,
			});
		});

		it('refuses a version of the tree that it does not know', () => {
			assert.deepStrictEqual(run([backup, '--tree-version=3']), {
				output: '✗ Expected --tree-version=3 to be one of: 1, 2\nSee more help with --help\n',
				exitCode: 2,
			});
		});

		it('reads the salt key before the source', () => {
			const keyFile = join(tmpdir(), 'esdb-merkle-missing.key');

			assert.deepStrictEqual(
				run(['--backup=/nonexistent/file.json', `--salt-key-file=${keyFile}`]),
				{
					output: `✗ Failed to calculate Merkle root: File not found: ${keyFile}\n`,
					exitCode: 1,
				},
			);
		});

		it('refuses a salt key file that holds no salt key, without showing what it holds', () => {
			const keyFile = writeKeyFile('not-a-key\n');

			assert.deepStrictEqual(run([backup, `--salt-key-file=${keyFile}`]), {
				output: `✗ Failed to calculate Merkle root: the salt key in ${keyFile} has to be 64 hexadecimal digits\n`,
				exitCode: 1,
			});
		});

		it('describes the flags of the tree in its help', () => {
			// The help wraps long descriptions, wherever the width of the terminal ends.
			const output = run(['--help']).output.replace(/\s+/gu, ' ');

			assert.ok(
				output.includes('File with the salt key to salt the leaves of the tree with'),
				output,
			);
			assert.ok(
				output.includes(
					'Version of the Merkle tree: 1 for roots that releases before 3.0 calculated',
				),
				output,
			);
		});
	});

	describe('with a last event ID', () => {
		// The older backup holds the first two events of the newer one, which
		// EventSourcingDB wrote before it wrote the others.
		it('calculates the root of an older backup again from a newer one', () => {
			const older = run(['--backup=test-fixtures/backup-before-version-2.ndjson']);
			const newer = run([
				'--backup=test-fixtures/backup-with-both-hash-versions.ndjson',
				'--last-event-id=1',
			]);

			assert.strictEqual(older.exitCode, 0, older.output);
			assert.match(older.output, twoEventsUpToEvent1);
			assert.strictEqual(newer.output, older.output);
		});

		it('takes a last event ID in another notation of the same number, as EventSourcingDB does', () => {
			const backup = '--backup=test-fixtures/backup-with-both-hash-versions.ndjson';

			assert.strictEqual(
				run([backup, '--last-event-id=01']).output,
				run([backup, '--last-event-id=1']).output,
			);
		});

		for (const lastEventId of ['abc', '']) {
			it(`refuses a last event ID that is no event ID, such as '${lastEventId}'`, () => {
				const { output, exitCode } = run([
					'--backup=test-fixtures/backup-with-both-hash-versions.ndjson',
					`--last-event-id=${lastEventId}`,
				]);

				assert.strictEqual(exitCode, 2);
				assert.strictEqual(
					output,
					`✗ --last-event-id has to be an event ID, but is '${lastEventId}'\nSee more help with --help\n`,
				);
			});
		}

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

	describe('with a stored hash of no known form', () => {
		const brokenBackup = join(testDir, 'merkle-root-broken-hash.json');

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

		it('refuses it in the tree of version 2, naming the event', () => {
			assert.deepStrictEqual(runCommand([`--backup=${brokenBackup}`]), {
				output: '✗ Failed to calculate Merkle root: event 0 has no hash of version 1 or 2\n',
				exitCode: 1,
			});
		});

		it('takes it in the tree of version 1, as releases before 3.0 did', () => {
			const { output, exitCode } = runCommand([`--backup=${brokenBackup}`, '--tree-version=1']);

			assert.strictEqual(exitCode, 0, output);
		});
	});
});
