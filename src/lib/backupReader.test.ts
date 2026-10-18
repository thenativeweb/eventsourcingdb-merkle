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
