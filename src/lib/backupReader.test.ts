import assert from 'node:assert';
import { describe, it } from 'node:test';
import { findEventById, readBackupFile } from './backupReader.js';

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
