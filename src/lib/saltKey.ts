import { createHmac, randomBytes } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';

// A salt key is 32 random bytes: RFC 2104 discourages keys for HMAC that are
// shorter than the output of the hash, and longer ones add nothing. It is kept
// as text of 64 hexadecimal digits, so that it can be stored wherever a password
// can, and whitespace around them is left out, so that a final newline, which
// one editor adds and another does not, does not make the same key another one.
const saltKeyLength = 32;
const saltKeyPattern = /^[0-9a-f]{64}$/iu;

export const readSaltKey = async (filePath: string): Promise<Buffer> => {
	try {
		await access(filePath);
	} catch {
		throw new Error(`File not found: ${filePath}`);
	}

	const digits = (await readFile(filePath, 'utf-8')).trim();

	// The message does not show what the file holds, since that may be a key
	// that was only written down wrong.
	if (!saltKeyPattern.test(digits)) {
		throw new Error(`the salt key in ${filePath} has to be 64 hexadecimal digits`);
	}

	return Buffer.from(digits, 'hex');
};

// writeSaltKey never overwrites a file, since a root whose leaves were salted
// with a key gets no further proof once the key is gone. Only the owner of the
// file may read it, and nobody may write it, so that it is not replaced by
// accident either, as by a command that redirects its output into it.
export const writeSaltKey = async (filePath: string): Promise<void> => {
	const digits = randomBytes(saltKeyLength).toString('hex');

	try {
		await writeFile(filePath, `${digits}\n`, { flag: 'wx', mode: 0o400 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			throw new Error(`${filePath} already exists`);
		}
		throw error;
	}
};

// deriveSalt derives the salt of a leaf from the key and the stored hash of its
// event, so that no salt has to be kept: whoever holds the key gets the same
// salts again, and whoever does not cannot tell them from random ones.
export const deriveSalt = (saltKey: Buffer, storedHash: string): Buffer =>
	createHmac('sha256', saltKey).update(storedHash, 'utf-8').digest();
