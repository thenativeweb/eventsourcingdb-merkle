import { createHmac, randomBytes } from 'node:crypto';
import { access, type FileHandle, open, readFile, unlink } from 'node:fs/promises';

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
// with a key gets no further proof once the key is gone. Nobody may write the
// file, so that it is not replaced by accident either, as by a command that
// redirects its output into it, and on Linux and macOS, only its owner may read
// it. Windows knows only whether a file is read-only, so there, who may read it
// follows from the permissions of its folder.
export const writeSaltKey = async (filePath: string): Promise<void> => {
	const digits = randomBytes(saltKeyLength).toString('hex');

	let file: FileHandle;
	try {
		file = await open(filePath, 'wx', 0o400);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			throw new Error(`${filePath} already exists`);
		}
		throw error;
	}

	// A root may be calculated and published with the key right after it was
	// written, so the content of the file reaches the disk before the key counts as
	// written. Its entry in the folder is not flushed on its own, so whether a key
	// written right before a power failure is found afterwards is left to the file
	// system. A file that could not be written completely is removed again, so that
	// it neither passes for a key nor keeps the next attempt from writing one. It
	// is closed first, which Windows needs to remove it, but a failure to close it
	// keeps it neither from being removed nor from reporting why writing it failed.
	try {
		await file.writeFile(`${digits}\n`);
		await file.sync();
	} catch (error) {
		await file.close().catch(() => undefined);
		await unlink(filePath);
		throw error;
	}

	await file.close();
};

// deriveSalt derives the salt of a leaf from the key and the stored hash of its
// event, so that no salt has to be kept: whoever holds the key gets the same
// salts again, and whoever does not cannot tell them from random ones.
export const deriveSalt = (saltKey: Buffer, storedHash: string): Buffer =>
	createHmac('sha256', saltKey).update(storedHash, 'utf-8').digest();
