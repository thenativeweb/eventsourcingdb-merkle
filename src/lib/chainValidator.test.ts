import assert from 'node:assert';
import { describe, it } from 'node:test';
import { readBackupFile } from './backupReader.js';
import { validateChain } from './chainValidator.js';

describe('validateChain', () => {
	it('validates a correct chain', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');
		const result = validateChain(entries);

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

		const result = validateChain(entries);

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

		const result = validateChain(entries);

		assert.strictEqual(result.isValid, false);
		assert.ok(result.errors.some(e => e.message.includes('Predecessor hash mismatch')));
	});

	it('validates first event has null predecessor', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');
		// Tamper with first event's predecessor
		const [firstEntry] = entries;
		assert.ok(firstEntry);
		firstEntry.payload.event.predecessorhash = 'invalid';

		const result = validateChain(entries);

		assert.strictEqual(result.isValid, false);
		assert.ok(result.errors.some(e => e.message.includes('null predecessor hash')));
	});
});
