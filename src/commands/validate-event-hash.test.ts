import assert from 'node:assert';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

// formatLine adds whitespace between the tokens of a line, as a viewer or jq
// without -c does, and keeps what is inside strings, escape sequences included.
const formatLine = (line: string): string => {
	let formatted = '';
	let isInString = false;

	for (let index = 0; index < line.length; index++) {
		const character = line[index];
		formatted += character;

		if (isInString) {
			if (character === '\\') {
				index++;
				formatted += line[index];
			} else if (character === '"') {
				isInString = false;
			}
			continue;
		}

		if (character === '"') {
			isInString = true;
		} else if (character === '{' || character === '[' || character === ',') {
			formatted += '\n  ';
		} else if (character === ':') {
			formatted += ' ';
		}
	}

	return formatted;
};

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
			`node ./dist/index.js validate-event-hash --file ${testBackup} --event-id 0`,
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
				execSync(`node ./dist/index.js validate-event-hash --file ${testBackup} --event-id 999`, {
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
		const output = execSync(`node ./dist/index.js validate-event-hash --event '${event}'`, {
			encoding: 'utf-8',
		});
		// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
		assert.match(output, /Calculated hash:/);
	});

	it('shows error when event-id is missing with file', () => {
		assert.throws(
			() => {
				execSync(`node ./dist/index.js validate-event-hash --file ${testBackup}`, {
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
				execSync('node ./dist/index.js validate-event-hash', {
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

	describe('with data that holds braces inside strings, or characters that EventSourcingDB escapes', () => {
		const backupLines = readFileSync('test-fixtures/backup-with-tricky-data.ndjson', 'utf-8')
			.trimEnd()
			.split('\n');

		for (const [index, line] of backupLines.entries()) {
			it(`validates the hash of event ${index} given as a line of a backup`, () => {
				const output = execFileSync(
					'node',
					['./dist/index.js', 'validate-event-hash', `--event=${line}`],
					{ encoding: 'utf-8' },
				);
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /✓ Hash is valid/);
			});

			it(`validates the hash of event ${index} given as a formatted line of a backup`, () => {
				const formattedLine = formatLine(line);
				assert.notStrictEqual(formattedLine, line);
				assert.deepStrictEqual(JSON.parse(formattedLine), JSON.parse(line));

				const output = execFileSync(
					'node',
					['./dist/index.js', 'validate-event-hash', `--event=${formattedLine}`],
					{ encoding: 'utf-8' },
				);
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /✓ Hash is valid/);
			});

			it(`calculates the stored hash of event ${index} given as an event without a hash`, () => {
				const { event, hash } = (JSON.parse(line) as { payload: { event: unknown; hash: string } })
					.payload;
				const eventLine = line.slice(line.indexOf('{"source"'), line.lastIndexOf(',"hash"'));
				assert.deepStrictEqual(JSON.parse(eventLine), event);

				const output = execFileSync(
					'node',
					['./dist/index.js', 'validate-event-hash', `--event=${eventLine}`],
					{ encoding: 'utf-8' },
				);
				assert.strictEqual(output, `Calculated hash: ${hash}\n`);
			});
		}
	});

	describe('with both versions of the hash', () => {
		const readEventsLines = readFileSync(
			'test-fixtures/read-events-with-both-hash-versions.ndjson',
			'utf-8',
		)
			.trimEnd()
			.split('\n');

		const runWithEvent = (event: string): { output: string; exitCode: number } => {
			try {
				const output = execFileSync(
					'node',
					['./dist/index.js', 'validate-event-hash', `--event=${event}`],
					{
						encoding: 'utf-8',
					},
				);
				return { output, exitCode: 0 };
			} catch (error: unknown) {
				const { stdout, status } = error as { stdout: string; status: number };
				return { output: stdout, exitCode: status };
			}
		};

		it('validates the hash of an event of either version from a backup', () => {
			for (const eventId of ['1', '3']) {
				const output = execSync(
					`node ./dist/index.js validate-event-hash --file test-fixtures/backup-with-both-hash-versions.ndjson --event-id ${eventId}`,
					{ encoding: 'utf-8' },
				);
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /✓ Hash is valid/);
			}
		});

		for (const [index, line] of readEventsLines.entries()) {
			it(`validates the hash of event ${index} given as a line of read-events`, () => {
				const { output, exitCode } = runWithEvent(line);

				assert.strictEqual(exitCode, 0, output);
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /✓ Hash is valid/);
			});

			it(`validates the hash of event ${index} given as an event that carries its hash`, () => {
				const event = line.slice(line.indexOf('{"source"'), -1);
				assert.ok((JSON.parse(event) as { hash?: string }).hash);

				const { output, exitCode } = runWithEvent(event);

				assert.strictEqual(exitCode, 0, output);
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /✓ Hash is valid/);
			});
		}

		it('reports a hash of a version it does not know as unsupported', () => {
			const [line] = readEventsLines.slice(-1);
			assert.ok(line);
			const storedHash = `esdb:hash:v3:${'0'.repeat(64)}`;
			// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
			const event = line.replace(/"hash":"[^"]*"/u, `"hash":"${storedHash}"`);

			const { output, exitCode } = runWithEvent(event);

			assert.strictEqual(exitCode, 1);
			assert.strictEqual(
				output,
				`✗ Unsupported hash version: v3\nEvent ID: 3\nStored hash: ${storedHash}\n`,
			);
		});

		it('refuses an event in a form it does not know', () => {
			const { output, exitCode } = runWithEvent('{"type":"event","payload":{"id":"0"}}');

			assert.strictEqual(exitCode, 2);
			assert.strictEqual(
				output,
				'✗ --event is neither an event nor a line of a backup or of read-events\nSee more help with --help\n',
			);
		});
	});

	describe('with a backup that the v2 API wrote', () => {
		const eventLines = readFileSync('test-fixtures/backup-v2-full.ndjson', 'utf-8')
			.trimEnd()
			.split('\n')
			.filter(line => line.startsWith('{"type":"event"'));

		it('validates the hash of an event of the backup', () => {
			const output = execSync(
				'node ./dist/index.js validate-event-hash --file test-fixtures/backup-v2-full.ndjson --event-id 2',
				{ encoding: 'utf-8' },
			);
			// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
			assert.match(output, /✓ Hash is valid/);
		});

		for (const [index, line] of eventLines.entries()) {
			it(`validates the hash of event ${index} given as a line of the backup`, () => {
				const output = execFileSync(
					'node',
					['./dist/index.js', 'validate-event-hash', `--event=${line}`],
					{ encoding: 'utf-8' },
				);
				// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
				assert.match(output, /✓ Hash is valid/);
			});
		}
	});
});
