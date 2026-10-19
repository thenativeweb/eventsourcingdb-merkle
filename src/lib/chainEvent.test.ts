import assert from 'node:assert';
import { describe, it } from 'node:test';
import { type Event, HashVerificationFailedError } from 'eventsourcingdb';
import { readBackupFile } from './backupReader.js';
import { findEventById, fromBackupEntry, fromDatabaseEvent } from './chainEvent.js';
import { UnsupportedHashVersionError } from './hash.js';

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

describe('fromDatabaseEvent', () => {
	// An event as the SDK hands it on, which verifies its own hash. A running
	// database holds no event that fails to, so the test stands in for one.
	const eventThat = (hash: string, verifyHash: () => void): Event => {
		return { id: '7', hash, predecessorhash: '0'.repeat(64), verifyHash } as unknown as Event;
	};
	const hashOfVersion2 = `esdb:hash:v2:${'1'.repeat(64)}`;

	it('reports an event whose hash matches', () => {
		const event = fromDatabaseEvent(eventThat(hashOfVersion2, () => undefined));

		assert.deepStrictEqual(event.checkHash(), { isMatching: true, calculatedHash: undefined });
	});

	it('reports an event whose hash does not match, without the hash it calculated', () => {
		const event = fromDatabaseEvent(
			eventThat(hashOfVersion2, () => {
				throw new HashVerificationFailedError();
			}),
		);

		assert.deepStrictEqual(event.checkHash(), { isMatching: false, calculatedHash: undefined });
	});

	it('refuses a hash of a version the tool does not know, as for a backup', () => {
		const event = fromDatabaseEvent(eventThat(`esdb:hash:v3:${'1'.repeat(64)}`, () => undefined));

		assert.throws(
			() => event.checkHash(),
			(error: Error) => {
				assert.ok(error instanceof UnsupportedHashVersionError);
				assert.strictEqual(error.message, 'Unsupported hash version: v3');
				return true;
			},
		);
	});
});
