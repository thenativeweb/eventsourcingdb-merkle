import assert from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { type FileHandle, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { deriveSalt, readSaltKey, writeSaltKey } from './saltKey.js';

const getTemporaryPath = (name: string): string =>
	join(mkdtempSync(join(tmpdir(), 'esdb-merkle-salt-key-')), name);

const saltKeyFilePattern = /^[0-9a-f]{64}\n$/u;

// The prototype of the handles that node:fs/promises opens files with, whose
// methods the tests replace to see when a key reaches the disk.
const getFileHandlePrototype = async (): Promise<FileHandle> => {
	const file = await open(getTemporaryPath('probe'), 'w');
	await file.close();

	return Object.getPrototypeOf(file) as FileHandle;
};

const keyDigits = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

describe('readSaltKey', () => {
	for (const [name, text] of [
		['with a final newline', `${keyDigits}\n`],
		['without a final newline', keyDigits],
		['with whitespace around it', ` \r\n\t${keyDigits}\r\n \n`],
		['in upper case', `${keyDigits.toUpperCase()}\n`],
	]) {
		it(`reads the key from 64 hexadecimal digits ${name}`, async () => {
			const filePath = getTemporaryPath('merkle.key');
			writeFileSync(filePath, text ?? '');

			assert.deepStrictEqual(await readSaltKey(filePath), Buffer.from(keyDigits, 'hex'));
		});
	}

	for (const [name, text] of [
		['fewer digits', keyDigits.slice(1)],
		['more digits', `${keyDigits}0`],
		['a character that is no hexadecimal digit', `${keyDigits.slice(1)}g`],
		['whitespace between the digits', `${keyDigits.slice(0, 32)} ${keyDigits.slice(32)}`],
		['nothing', ''],
		['32 raw bytes', Buffer.from(keyDigits, 'hex').toString('latin1')],
	]) {
		it(`refuses a file with ${name}, without showing its content`, async () => {
			const filePath = getTemporaryPath('merkle.key');
			writeFileSync(filePath, text ?? '', 'latin1');

			await assert.rejects(readSaltKey(filePath), {
				message: `the salt key in ${filePath} has to be 64 hexadecimal digits`,
			});
		});
	}

	it('reports a file that does not exist', async () => {
		const filePath = getTemporaryPath('missing.key');

		await assert.rejects(readSaltKey(filePath), { message: `File not found: ${filePath}` });
	});
});

describe('writeSaltKey', () => {
	it('writes a key of 64 hexadecimal digits that reads back', async () => {
		const filePath = getTemporaryPath('merkle.key');

		await writeSaltKey(filePath);

		const text = readFileSync(filePath, 'utf-8');
		assert.match(text, saltKeyFilePattern);
		assert.deepStrictEqual(await readSaltKey(filePath), Buffer.from(text.trim(), 'hex'));
	});

	it('writes a new key every time', async () => {
		const firstPath = getTemporaryPath('first.key');
		const secondPath = getTemporaryPath('second.key');

		await writeSaltKey(firstPath);
		await writeSaltKey(secondPath);

		assert.notStrictEqual(readFileSync(firstPath, 'utf-8'), readFileSync(secondPath, 'utf-8'));
	});

	// Windows knows no such permissions, only whether a file is read-only.
	it('lets only its owner read the key, and nobody write it', {
		skip: process.platform === 'win32',
	}, async () => {
		const filePath = getTemporaryPath('merkle.key');

		await writeSaltKey(filePath);

		// The permissions are the lowest nine bits of the mode.
		assert.strictEqual(statSync(filePath).mode % 0o1000, 0o400);
	});

	it('never overwrites a file', async () => {
		const filePath = getTemporaryPath('merkle.key');
		writeFileSync(filePath, `${keyDigits}\n`);

		await assert.rejects(writeSaltKey(filePath), { message: `${filePath} already exists` });
		assert.strictEqual(readFileSync(filePath, 'utf-8'), `${keyDigits}\n`);
	});

	it('reports a directory that does not exist', async () => {
		const filePath = join(getTemporaryPath('missing'), 'merkle.key');

		await assert.rejects(writeSaltKey(filePath), { code: 'ENOENT' });
	});

	it('flushes the key to the disk before it returns', async test => {
		const filePath = getTemporaryPath('merkle.key');
		const prototype = await getFileHandlePrototype();
		const syncedTexts: string[] = [];
		const { sync } = prototype;
		test.mock.method(prototype, 'sync', async function (this: FileHandle) {
			syncedTexts.push(readFileSync(filePath, 'utf-8'));
			await sync.call(this);
		});

		await writeSaltKey(filePath);

		assert.deepStrictEqual(syncedTexts, [readFileSync(filePath, 'utf-8')]);
	});

	it('removes a key that it could not write completely', async test => {
		const filePath = getTemporaryPath('merkle.key');
		test.mock.method(await getFileHandlePrototype(), 'sync', () =>
			Promise.reject(new Error('the disk failed')),
		);

		await assert.rejects(writeSaltKey(filePath), { message: 'the disk failed' });
		assert.strictEqual(existsSync(filePath), false);
	});
});

describe('deriveSalt', () => {
	// Test case 2 of RFC 4231, which gives the HMAC-SHA256 of a key and of data
	// that are both short text.
	it('derives the salt as the HMAC-SHA256 of the stored hash', () => {
		assert.strictEqual(
			deriveSalt(Buffer.from('Jefe'), 'what do ya want for nothing?').toString('hex'),
			'5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
		);
	});

	it('derives another salt for another stored hash', () => {
		const saltKey = Buffer.from(keyDigits, 'hex');

		assert.notDeepStrictEqual(deriveSalt(saltKey, 'abc'), deriveSalt(saltKey, 'abd'));
	});
});
