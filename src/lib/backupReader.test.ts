import assert from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { findEventById, readBackupFile } from './backupReader.js';

// A backup that EventSourcingDB 1.2.0 wrote for a store with a registered
// schema, which it writes as a line of its own before the events.
const backupWithSchema = 'test-fixtures/backup-with-schema.ndjson';

const writeBackup = (lines: string[]): string => {
	const directory = mkdtempSync(join(tmpdir(), 'esdb-merkle-'));
	const filePath = join(directory, 'backup.ndjson');
	writeFileSync(filePath, `${lines.join('\n')}\n`);

	return filePath;
};

const linesOfBackupWithSchema = (): string[] => {
	return readFileSync(backupWithSchema, 'utf-8').trimEnd().split('\n');
};

describe('readBackupFile', () => {
	it('reads a backup file with multiple events', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');

		assert.strictEqual(entries.length, 4);
		const [first, second, third, fourth] = entries;
		assert.ok(first);
		assert.ok(second);
		assert.ok(third);
		assert.ok(fourth);
		assert.strictEqual(first.type, 'event');
		assert.strictEqual(first.payload.event.id, '0');
		assert.strictEqual(second.payload.event.id, '1');
		assert.strictEqual(third.payload.event.id, '2');
		assert.strictEqual(fourth.payload.event.id, '3');
	});

	it('parses event data correctly', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');
		const [firstEntry] = entries;
		assert.ok(firstEntry);
		const firstEvent = firstEntry.payload.event;

		assert.strictEqual(firstEvent.specversion, '1.0');
		assert.strictEqual(firstEvent.type, 'com.example.item.created');
		assert.strictEqual(firstEvent.datacontenttype, 'application/json');
		assert.deepStrictEqual(firstEvent.data, {
			title: 'Lorem ipsum',
			description: 'Dolor sit amet',
		});
	});

	it('reads hash from payload', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');
		const [firstEntry] = entries;
		assert.ok(firstEntry);

		// biome-ignore lint/security/noSecrets: This is a SHA256 hash for testing
		const expectedHash = 'a5137d458a5639ee5d1f1248559058b2dfc25c98c8731aefc3efbf9decb5dbeb';
		assert.strictEqual(firstEntry.payload.hash, expectedHash);
	});
});

describe('findEventById', () => {
	it('finds an event by its ID', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');
		const event = findEventById(entries, '2');

		assert.ok(event);
		assert.strictEqual(event.payload.event.id, '2');
	});

	it('returns undefined for non-existent ID', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');
		const event = findEventById(entries, '999');

		assert.strictEqual(event, undefined);
	});
});

describe('readBackupFile with lines other than events', () => {
	it('skips the schema lines of a backup', async () => {
		const entries = await readBackupFile(backupWithSchema);

		assert.deepStrictEqual(
			entries.map(entry => entry.payload.event.id),
			['0', '1'],
		);
	});

	it('reports a backup that holds an error line as incomplete', async () => {
		const filePath = writeBackup([
			...linesOfBackupWithSchema(),
			'{"type":"error","payload":"database is shutting down: try again later"}',
		]);

		await assert.rejects(readBackupFile(filePath), {
			message:
				'the backup is incomplete: line 4 reports an error: database is shutting down: try again later',
		});
	});

	it('aborts at a line of an unknown type', async () => {
		const filePath = writeBackup([
			...linesOfBackupWithSchema(),
			'{"type":"backup","data":{"formatVersion":2,"lastBackedUpEvent":null}}',
		]);

		await assert.rejects(readBackupFile(filePath), {
			message: 'line 4 has an unknown type: backup',
		});
	});

	it('counts blank lines when it names a line', async () => {
		const [schemaLine] = linesOfBackupWithSchema();
		assert.ok(schemaLine);
		const filePath = writeBackup([
			schemaLine,
			'',
			'{"type":"backup","data":{"formatVersion":2,"lastBackedUpEvent":null}}',
		]);

		await assert.rejects(readBackupFile(filePath), {
			message: 'line 3 has an unknown type: backup',
		});
	});

	for (const line of ['42', 'null', '[]', '{}', '{"type":{"name":"event"}}']) {
		it(`aborts at a line without a type, such as ${line}`, async () => {
			const [schemaLine] = linesOfBackupWithSchema();
			assert.ok(schemaLine);
			const filePath = writeBackup([schemaLine, line]);

			await assert.rejects(readBackupFile(filePath), {
				message: 'line 2 has no type',
			});
		});
	}

	it('aborts at a line that is not JSON', async () => {
		const [schemaLine, firstEventLine] = linesOfBackupWithSchema();
		assert.ok(schemaLine);
		assert.ok(firstEventLine);
		const filePath = writeBackup([schemaLine, firstEventLine.slice(0, 40)]);

		await assert.rejects(readBackupFile(filePath), (error: Error) => {
			assert.ok(error.message.startsWith('line 2 is not valid JSON: '), error.message);

			return true;
		});
	});

	it('aborts at an event line without an event', async () => {
		const filePath = writeBackup([
			...linesOfBackupWithSchema(),
			'{"type":"event","payload":{"hash":"0000000000000000000000000000000000000000000000000000000000000000"}}',
		]);

		await assert.rejects(readBackupFile(filePath), {
			message: 'line 4 has an event line without an event',
		});
	});

	it('aborts at an event line whose payload is null', async () => {
		const filePath = writeBackup([...linesOfBackupWithSchema(), '{"type":"event","payload":null}']);

		await assert.rejects(readBackupFile(filePath), {
			message: 'line 4 has an event line without an event',
		});
	});

	it('aborts at an event line without a hash', async () => {
		const [schemaLine, firstEventLine] = linesOfBackupWithSchema();
		assert.ok(schemaLine);
		assert.ok(firstEventLine);
		const eventLine = JSON.parse(firstEventLine) as { payload: { hash?: string } };
		// Serializing leaves out a member that is undefined.
		eventLine.payload.hash = undefined;
		const filePath = writeBackup([schemaLine, JSON.stringify(eventLine)]);

		await assert.rejects(readBackupFile(filePath), {
			message: 'line 2 has an event line without a hash',
		});
	});
});

describe('readBackupFile with data that holds braces inside strings, or characters that EventSourcingDB escapes', () => {
	// A backup that EventSourcingDB 1.2.0 wrote, whose data holds braces,
	// brackets, quotes, and backslashes inside strings, characters that it
	// escapes, and characters beyond ASCII.
	const backupWithTrickyData = 'test-fixtures/backup-with-tricky-data.ndjson';

	it('takes the data of every event exactly as it appears in its line', async () => {
		const entries = await readBackupFile(backupWithTrickyData);

		assert.deepStrictEqual(
			entries.map(entry => entry.payload.originalDataString),
			[
				'{"note":"a } b { c","title":"Braces in a string"}',
				// biome-ignore lint/security/noSecrets: Escape sequences of test data, not a secret
				'{"borrower":"Tom \\u0026 \\u003cJerry\\u003e"}',
				'{"list":["{","}","]["],"nested":{"data":{"x":"}"}},"quote":"say \\"hi\\" \\\\ done","title":"2001 – A Space Odyssey, é"}',
			],
		);
	});
});

describe('readBackupFile with a backup that the v2 API wrote', () => {
	// A full backup, an increment that follows on it, and an empty increment that
	// follows on that one, as a preview of EventSourcingDB 1.3 wrote them on
	// /api/v2/management/create-backup, which its restore takes one after the
	// other in a single file. The store holds events of both versions of the hash.
	const linesOf = (fileName: string): string[] => {
		return readFileSync(`test-fixtures/${fileName}`, 'utf-8').trimEnd().split('\n');
	};
	const full = linesOf('backup-v2-full.ndjson');
	const increment = linesOf('backup-v2-increment.ndjson');
	const emptyIncrement = linesOf('backup-v2-empty-increment.ndjson');

	const withoutEnd = (lines: string[]): string[] => lines.slice(0, -1);

	it('reads the events of a full backup', async () => {
		const entries = await readBackupFile('test-fixtures/backup-v2-full.ndjson');

		assert.deepStrictEqual(
			entries.map(entry => entry.payload.event.id),
			['0', '1', '2'],
		);
		for (const [index, entry] of entries.entries()) {
			const eventLine = full.find(line => line.includes(`"id":"${index}"`)) ?? '';
			assert.ok(eventLine.includes(`"hash":"${entry.payload.hash}"`));
			assert.ok(eventLine.includes(`"data":${entry.payload.originalDataString}`));
		}
	});

	it('reads a full backup followed by its increments as one chain of events', async () => {
		const entries = await readBackupFile(writeBackup([...full, ...increment, ...emptyIncrement]));

		assert.deepStrictEqual(
			entries.map(entry => entry.payload.event.id),
			['0', '1', '2', '3', '4'],
		);
	});

	it('skips heartbeats', async () => {
		const heartbeat = '{"type":"heartbeat","data":{}}';
		const [header, ...rest] = full;
		assert.ok(header);
		const entries = await readBackupFile(writeBackup([heartbeat, header, heartbeat, ...rest]));

		assert.strictEqual(entries.length, 3);
	});

	it('takes an increment that names its anchor by an ID in another notation', async () => {
		const [header, ...rest] = increment;
		assert.ok(header);
		const entries = await readBackupFile(
			writeBackup([...full, header.replace('"id":"2"', '"id":"02"'), ...rest]),
		);

		assert.strictEqual(entries.length, 5);
	});

	const cases: { name: string; lines: () => string[]; message: string }[] = [
		{
			name: 'a part without its end line',
			lines: () => withoutEnd(full),
			message: 'the backup is incomplete: part 0 lacks its end line',
		},
		{
			name: 'an increment without its end line',
			lines: () => [...full, ...withoutEnd(increment)],
			message: 'the backup is incomplete: part 1 lacks its end line',
		},
		{
			name: 'an error line',
			lines: () => [
				...withoutEnd(full),
				'{"type":"error","data":{"code":"database-shutting-down","description":"database is shutting down: try again later","details":{}}}',
			],
			message:
				'the backup is incomplete: line 7 reports an error: database is shutting down: try again later',
		},
		{
			name: 'a format version it does not know',
			lines: () => [
				full[0]?.replace('"formatVersion":2', '"formatVersion":3') ?? '',
				...full.slice(1),
			],
			message: 'line 1 has an unsupported backup format version: 3',
		},
		{
			name: 'a backup line without a format version',
			lines: () => [full[0]?.replace('"formatVersion":2,', '') ?? '', ...full.slice(1)],
			message: 'line 1 has an unsupported backup format version: none',
		},
		{
			name: 'an increment that comes first',
			lines: () => increment,
			message: 'line 1 begins an increment, but a backup has to begin with a full backup',
		},
		{
			name: 'an increment that does not follow on the part before it',
			lines: () => [...full, ...emptyIncrement],
			message: 'line 8 begins an increment that does not follow on the part before it',
		},
		{
			name: 'a part that begins before the part before it ended',
			lines: () => [...withoutEnd(full), ...increment],
			message: 'line 7 begins a part before the part before it ended',
		},
		{
			name: 'an event line before the first backup line',
			lines: () => full.slice(2),
			message: 'line 1 has to begin a part with a backup line, but has the type event',
		},
		{
			name: 'an event line after the end of a part',
			lines: () => [...full, full[2] ?? ''],
			message: 'line 8 has to begin a part with a backup line, but has the type event',
		},
		{
			name: 'a schema after the events of its part',
			lines: () => [full[0] ?? '', full[2] ?? '', full[1] ?? '', ...full.slice(3)],
			message: 'line 3 holds a schema after the events of its part',
		},
		{
			name: 'a line of an unknown type',
			lines: () => [...withoutEnd(full), '{"type":"foo","data":{}}'],
			message: 'line 7 has an unknown type: foo',
		},
		{
			name: 'an event line without an event',
			lines: () => [...withoutEnd(full), '{"type":"event","data":null}'],
			message: 'line 7 has an event line without an event',
		},
		{
			name: 'an event line without a hash',
			// biome-ignore lint/performance/useTopLevelRegex: Regex literals inline are acceptable in test files
			lines: () => [full[0] ?? '', full[1] ?? '', (full[2] ?? '').replace(/,"hash":"[^"]*"/u, '')],
			message: 'line 3 has an event line without a hash',
		},
	];

	for (const { name, lines, message } of cases) {
		it(`aborts at ${name}`, async () => {
			await assert.rejects(readBackupFile(writeBackup(lines())), { message });
		});
	}
});
