import assert from 'node:assert';
import { describe, it } from 'node:test';
import { calculateEventHash, hashPair } from './hash.js';
import type { CloudEvent } from './types.js';

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
