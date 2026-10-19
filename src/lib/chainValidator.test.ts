import assert from 'node:assert';
import { describe, it } from 'node:test';
import { readBackupFile } from './backupReader.js';
import { fromBackupEntry } from './chainEvent.js';
import { validateChain } from './chainValidator.js';

describe('validateChain', () => {
	it('validates a correct chain', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');
		const result = validateChain(entries.map(fromBackupEntry));

		assert.strictEqual(result.isValid, true);
		assert.strictEqual(result.totalEvents, 4);
		assert.strictEqual(result.errors.length, 0);
	});

	it('detects hash mismatch', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');
		// Tamper with hash
		const [, secondEntry] = entries;
		assert.ok(secondEntry);
		secondEntry.payload.hash = 'tampered';

		const result = validateChain(entries.map(fromBackupEntry));

		assert.strictEqual(result.isValid, false);
		assert.strictEqual(result.errors.length, 2); // Hash mismatch + predecessor hash mismatch
		assert.ok(result.errors.some(e => e.message.includes('Hash mismatch')));
	});

	it('detects predecessor hash mismatch', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');
		// Tamper with predecessor hash
		const [, , thirdEntry] = entries;
		assert.ok(thirdEntry);
		thirdEntry.payload.event.predecessorhash = 'tampered';

		const result = validateChain(entries.map(fromBackupEntry));

		assert.strictEqual(result.isValid, false);
		assert.ok(result.errors.some(e => e.message.includes('Predecessor hash mismatch')));
	});

	it('validates first event has null predecessor', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');
		// Tamper with first event's predecessor
		const [firstEntry] = entries;
		assert.ok(firstEntry);
		firstEntry.payload.event.predecessorhash = 'invalid';

		const result = validateChain(entries.map(fromBackupEntry));

		assert.strictEqual(result.isValid, false);
		assert.ok(result.errors.some(e => e.message.includes('null predecessor hash')));
	});

	it('validates a chain that holds events of both versions of the hash', async () => {
		const entries = await readBackupFile('test-fixtures/backup-with-both-hash-versions.ndjson');
		const result = validateChain(entries.map(fromBackupEntry));

		assert.deepStrictEqual(result, { isValid: true, totalEvents: 4, errors: [] });
	});

	it('reports a hash of a version it does not know as unsupported', async () => {
		const entries = await readBackupFile('test-fixtures/backup-with-both-hash-versions.ndjson');
		const lastEntry = entries.at(-1);
		assert.ok(lastEntry);
		lastEntry.payload.hash = `esdb:hash:v3:${'0'.repeat(64)}`;

		const result = validateChain(entries.map(fromBackupEntry));

		assert.deepStrictEqual(result.errors, [
			{ eventId: '3', message: 'Unsupported hash version: v3' },
		]);
	});

	it('reports a mismatch without the calculated hash where the source does not tell it', () => {
		const hash = `esdb:hash:v2:${'1'.repeat(64)}`;
		const result = validateChain([
			{
				id: '0',
				hash,
				predecessorhash: '0'.repeat(64),
				checkHash: () => ({ isMatching: false, calculatedHash: undefined }),
			},
		]);

		assert.deepStrictEqual(result.errors, [
			{ eventId: '0', message: `Hash mismatch: expected ${hash}` },
		]);
	});
});
