import assert from 'node:assert';
import { describe, it } from 'node:test';
import { describeHashMismatch } from './hashReport.js';

describe('describeHashMismatch', () => {
	const event = { id: '42', hash: 'abc' };

	it('names the stored and the calculated hash where the source tells both', () => {
		assert.deepStrictEqual(describeHashMismatch(event, 'def'), [
			'✗ Hash mismatch',
			'Event ID: 42',
			'Stored hash:     abc',
			'Calculated hash: def',
		]);
	});

	it('names the stored hash only where the source does not tell the calculated one', () => {
		assert.deepStrictEqual(describeHashMismatch(event, undefined), [
			'✗ Hash mismatch',
			'Event ID: 42',
			'Stored hash: abc',
		]);
	});
});
