import assert from 'node:assert';
import { describe, it } from 'node:test';
import { readBackupFile } from './backupReader.js';
import { findEventById, fromBackupEntry } from './chainEvent.js';

describe('findEventById', () => {
	it('finds an event by its ID', async () => {
		const events = (await readBackupFile('test-fixtures/test-backup.json')).map(fromBackupEntry);
		const event = findEventById(events, '2');

		assert.ok(event);
		assert.strictEqual(event.id, '2');
	});

	it('finds an event by its ID in another notation of the same number', async () => {
		const events = (await readBackupFile('test-fixtures/test-backup.json')).map(fromBackupEntry);

		assert.strictEqual(findEventById(events, '02')?.id, '2');
	});

	it('returns undefined for non-existent ID', async () => {
		const events = (await readBackupFile('test-fixtures/test-backup.json')).map(fromBackupEntry);

		assert.strictEqual(findEventById(events, '999'), undefined);
		assert.strictEqual(findEventById(events, 'abc'), undefined);
	});
});
