import assert from 'node:assert';
import { describe, it } from 'node:test';
import { findEventById, readBackupFile } from './backupReader.js';

describe('readBackupFile', () => {
	it('reads a backup file with multiple events', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');

		assert.strictEqual(entries.length, 4);
		assert.strictEqual(entries[0].type, 'event');
		assert.strictEqual(entries[0].payload.event.id, '0');
		assert.strictEqual(entries[1].payload.event.id, '1');
		assert.strictEqual(entries[2].payload.event.id, '2');
		assert.strictEqual(entries[3].payload.event.id, '3');
	});

	it('parses event data correctly', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');
		const firstEvent = entries[0].payload.event;

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

		// biome-ignore lint/security/noSecrets: This is a SHA256 hash for testing
		const expectedHash = 'a5137d458a5639ee5d1f1248559058b2dfc25c98c8731aefc3efbf9decb5dbeb';
		assert.strictEqual(entries[0].payload.hash, expectedHash);
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
