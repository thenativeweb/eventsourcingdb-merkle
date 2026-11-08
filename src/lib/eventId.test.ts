import assert from 'node:assert';
import { describe, it } from 'node:test';
import { isEventId, parseEventId, parseStoredEventId } from './eventId.js';

describe('parseEventId', () => {
	for (const [id, eventId] of [
		['0', 0n],
		['42', 42n],
		['9223372036854775807', 9_223_372_036_854_775_807n],
	] as const) {
		it(`returns the number of '${id}'`, () => {
			assert.strictEqual(parseEventId(id), eventId);
		});
	}

	for (const id of ['03', '00', '+5', '-1', '-0', ' 5', '4.2', 'abc', '', '9223372036854775808']) {
		it(`refuses '${id}', as EventSourcingDB does`, () => {
			assert.strictEqual(parseEventId(id), undefined);
		});
	}
});

describe('parseStoredEventId', () => {
	for (const [id, eventId] of [
		['3', 3n],
		['03', 3n],
		['+3', 3n],
		['-1', -1n],
	] as const) {
		it(`returns the number of '${id}'`, () => {
			assert.strictEqual(parseStoredEventId(id), eventId);
		});
	}

	it('returns undefined for text that names no number', () => {
		assert.strictEqual(parseStoredEventId('abc'), undefined);
	});
});

describe('isEventId', () => {
	it('tells an event ID from anything else', () => {
		assert.strictEqual(isEventId('42'), true);
		assert.strictEqual(isEventId('042'), false);
		assert.strictEqual(isEventId(42), false);
	});
});
