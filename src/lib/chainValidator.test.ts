import assert from 'node:assert';
import { describe, it } from 'node:test';
import { readBackupFile } from './backupReader.js';
import { validateChain } from './chainValidator.js';

// biome-ignore lint/security/noSecrets: Test file contains SHA256 hashes, not secrets
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
		entries[1].payload.hash = 'tampered';

		const result = validateChain(entries);

		assert.strictEqual(result.isValid, false);
		assert.strictEqual(result.errors.length, 2); // Hash mismatch + predecessor hash mismatch
		assert.ok(result.errors.some(e => e.message.includes('Hash mismatch')));
	});

	it('detects predecessor hash mismatch', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');
		// Tamper with predecessor hash
		entries[2].payload.event.predecessorhash = 'tampered';

		const result = validateChain(entries);

		assert.strictEqual(result.isValid, false);
		assert.ok(result.errors.some(e => e.message.includes('Predecessor hash mismatch')));
	});

	it('validates first event has null predecessor', async () => {
		const entries = await readBackupFile('test-fixtures/test-backup.json');
		// Tamper with first event's predecessor
		entries[0].payload.event.predecessorhash = 'invalid';

		const result = validateChain(entries);

		assert.strictEqual(result.isValid, false);
		assert.ok(result.errors.some(e => e.message.includes('null predecessor hash')));
	});
});
