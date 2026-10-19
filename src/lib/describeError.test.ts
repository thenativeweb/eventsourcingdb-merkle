import assert from 'node:assert';
import { describe, it } from 'node:test';
import { describeError } from './describeError.js';

describe('describeError', () => {
	it('names the message of an error', () => {
		assert.strictEqual(
			describeError(new Error('the backup is incomplete')),
			'the backup is incomplete',
		);
	});

	it('adds the cause of an error, which names why a request failed', () => {
		const error = new TypeError('fetch failed', {
			cause: new Error('connect ECONNREFUSED 127.0.0.1:1'),
		});

		assert.strictEqual(describeError(error), 'fetch failed: connect ECONNREFUSED 127.0.0.1:1');
	});

	it('names a value that is no error', () => {
		assert.strictEqual(describeError('broken'), 'broken');
	});
});
