import assert from 'node:assert';
import { describe, it } from 'node:test';
import { getRawValue } from './rawJson.js';

describe('getRawValue', () => {
	it('returns a value exactly as it appears in the text', () => {
		const json = '{"data":{"title":"Tom \\u0026 \\u003cJerry\\u003e","pages":1e+21}}';

		assert.strictEqual(
			getRawValue(json, ['data']),
			'{"title":"Tom \\u0026 \\u003cJerry\\u003e","pages":1e+21}',
		);
	});

	it('follows a path of members', () => {
		const json = '{"type":"event","payload":{"event":{"id":"0","data":{"a":1}},"hash":"abc"}}';

		assert.strictEqual(getRawValue(json, ['payload', 'event', 'data']), '{"a":1}');
		assert.strictEqual(getRawValue(json, ['payload', 'hash']), '"abc"');
	});

	it('is not misled by braces, brackets, quotes, and backslashes inside strings', () => {
		const json =
			'{"a":"}]{[\\"\\\\","data":{"note":"a } b { c","list":["{","}","]["],"quote":"say \\"hi\\" \\\\ done"},"z":"}"}';

		assert.strictEqual(
			getRawValue(json, ['data']),
			'{"note":"a } b { c","list":["{","}","]["],"quote":"say \\"hi\\" \\\\ done"}',
		);
		assert.strictEqual(getRawValue(json, ['z']), '"}"');
	});

	it('takes a member of the given object, not one of the same name nested deeper', () => {
		const json = '{"event":{"nested":{"data":{"x":"}"}},"data":{"y":2}}}';

		assert.strictEqual(getRawValue(json, ['event', 'data']), '{"y":2}');
	});

	it('reads numbers, literals, and arrays as values', () => {
		const json = '{"n":-1.5e-7,"t":true,"f":false,"z":null,"l":[[],{}],"e":{}}';

		assert.strictEqual(getRawValue(json, ['n']), '-1.5e-7');
		assert.strictEqual(getRawValue(json, ['t']), 'true');
		assert.strictEqual(getRawValue(json, ['f']), 'false');
		assert.strictEqual(getRawValue(json, ['z']), 'null');
		assert.strictEqual(getRawValue(json, ['l']), '[[],{}]');
		assert.strictEqual(getRawValue(json, ['e']), '{}');
	});

	it('skips the whitespace between tokens, but keeps the whitespace inside a value', () => {
		const json = '{ "data" : { "a" : 1 } , "b" : 2 }';

		assert.strictEqual(getRawValue(json, ['data']), '{ "a" : 1 }');
		assert.strictEqual(getRawValue(json, ['b']), '2');
	});

	it('compares keys by their decoded text', () => {
		// biome-ignore lint/security/noSecrets: Escape sequences of test data, not a secret
		const json = '{"d\\u0061ta":{"a":1}}';

		assert.strictEqual(getRawValue(json, ['data']), '{"a":1}');
	});

	it('takes the last of several members of the same name, as JSON.parse does', () => {
		const json = '{"data":{"a":1},"data":{"b":2}}';

		assert.strictEqual(getRawValue(json, ['data']), '{"b":2}');
	});

	it('returns undefined for a member that is missing, or a path through a value that is no object', () => {
		const json = '{"data":{"a":1},"list":[1],"text":"x"}';

		assert.strictEqual(getRawValue(json, ['missing']), undefined);
		assert.strictEqual(getRawValue(json, ['data', 'missing']), undefined);
		assert.strictEqual(getRawValue(json, ['list', 'a']), undefined);
		assert.strictEqual(getRawValue(json, ['text', 'a']), undefined);
		assert.strictEqual(getRawValue('[1]', ['data']), undefined);
	});
});
