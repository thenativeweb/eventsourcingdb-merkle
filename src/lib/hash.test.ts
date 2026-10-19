import assert from 'node:assert';
import { describe, it } from 'node:test';
import { readBackupFile } from './backupReader.js';
import { calculateEventHash, hashPair, UnsupportedHashVersionError } from './hash.js';
import type { BackupEntry, CloudEvent } from './types.js';

// A backup that EventSourcingDB wrote for a store that holds events of both
// versions of the hash: those of version 1, written by release 1.2.0, and
// those of version 2, written by a preview of release 1.3 after a restore,
// each version once with and once without trace fields.
const backupWithBothHashVersions = 'test-fixtures/backup-with-both-hash-versions.ndjson';

const findEntry = (entries: BackupEntry[], eventId: string): BackupEntry => {
	const entry = entries.find(candidate => candidate.payload.event.id === eventId);
	if (entry === undefined) {
		throw new Error(`Test fixture lacks the event ${eventId}`);
	}

	return entry;
};

describe('calculateEventHash', () => {
	it('calculates the correct hash for an event', () => {
		const event: CloudEvent = {
			specversion: '1.0',
			id: '0',
			time: '2024-01-01T12:00:00.000000000Z',
			source: 'tag:example.com,2024:test:app',
			subject: '/test-subject/items/00000000-0000-0000-0000-000000000001',
			type: 'com.example.item.created',
			datacontenttype: 'application/json',
			predecessorhash: '0000000000000000000000000000000000000000000000000000000000000000',
			data: {
				title: 'Lorem ipsum',
				description: 'Dolor sit amet',
			},
		};

		const hash = calculateEventHash(event);

		// biome-ignore lint/security/noSecrets: This is a SHA256 hash for testing
		assert.strictEqual(hash, 'a5137d458a5639ee5d1f1248559058b2dfc25c98c8731aefc3efbf9decb5dbeb');
	});
});

describe('calculateEventHash with both versions of the hash', () => {
	it('calculates the hash of every event in the version its stored hash names', async () => {
		const entries = await readBackupFile(backupWithBothHashVersions);

		assert.deepStrictEqual(
			entries.map(entry => entry.payload.hash.startsWith('esdb:hash:v2:')),
			[false, false, true, true],
		);
		for (const entry of entries) {
			const { event, hash, originalDataString } = entry.payload;

			assert.strictEqual(calculateEventHash(event, originalDataString, hash), hash);
		}
	});

	it('covers the trace fields in version 2, but not in version 1', async () => {
		const entries = await readBackupFile(backupWithBothHashVersions);

		for (const [eventId, isCovered] of [
			['1', false],
			['3', true],
		] as const) {
			const { event, hash, originalDataString } = findEntry(entries, eventId).payload;
			assert.ok(event.tracestate);
			assert.strictEqual(calculateEventHash(event, originalDataString, hash), hash);

			const changedEvent = { ...event, tracestate: 'vendor=changed' };

			assert.strictEqual(
				calculateEventHash(changedEvent, originalDataString, hash) !== hash,
				isCovered,
			);
		}
	});

	it('refuses a hash whose prefix names a version it does not know', async () => {
		const entries = await readBackupFile(backupWithBothHashVersions);
		const { event, originalDataString } = findEntry(entries, '3').payload;

		for (const [storedHash, version] of [
			[`esdb:hash:v3:${'0'.repeat(64)}`, 'v3'],
			['esdb:hash:next', 'next'],
		] as const) {
			assert.throws(
				() => calculateEventHash(event, originalDataString, storedHash),
				(error: Error) => {
					assert.ok(error instanceof UnsupportedHashVersionError);
					assert.strictEqual(error.message, `Unsupported hash version: ${version}`);
					return true;
				},
			);
		}
	});
});

describe('hashPair', () => {
	it('hashes two strings together', () => {
		const hash1 = 'abc123';
		const hash2 = 'def456';

		const result = hashPair(hash1, hash2);

		assert.strictEqual(typeof result, 'string');
		assert.strictEqual(result.length, 64);
	});

	it('produces different results for different order', () => {
		const hash1 = 'abc123';
		const hash2 = 'def456';

		const result1 = hashPair(hash1, hash2);
		const result2 = hashPair(hash2, hash1);

		assert.notStrictEqual(result1, result2);
	});
});
