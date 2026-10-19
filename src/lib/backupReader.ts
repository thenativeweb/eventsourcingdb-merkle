import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { getCompactValue } from './rawJson.js';
import type { BackupEntry, CloudEvent } from './types.js';

export const readBackupFile = async (filePath: string): Promise<BackupEntry[]> => {
	// Check if file exists and is readable
	try {
		await access(filePath);
	} catch {
		throw new Error(`File not found: ${filePath}`);
	}

	const entries: BackupEntry[] = [];
	const fileStream = createReadStream(filePath);
	const rl = createInterface({
		input: fileStream,
		crlfDelay: Number.POSITIVE_INFINITY,
	});

	let lineNumber = 0;
	for await (const line of rl) {
		lineNumber++;

		if (line.trim() === '') {
			continue;
		}

		const entry = readLine(line, lineNumber);
		if (entry !== undefined) {
			entries.push(entry);
		}
	}

	return entries;
};

// readLine reads a line of a backup, and returns the event it holds, or nothing
// for a line that holds a schema, which neither the hashes nor the chain cover.
// Every other line ends the reading: an error line means that the backup was
// cut short, and a line of a type the format does not know means that the file
// is no backup the tool can read. Skipping either would let the events before
// it pass as a complete, valid chain.
const readLine = (line: string, lineNumber: number): BackupEntry | undefined => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch (error) {
		throw new Error(
			`line ${lineNumber} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const { type, payload } = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as {
		type?: unknown;
		payload?: unknown;
	};

	if (typeof type !== 'string') {
		throw new Error(`line ${lineNumber} has no type`);
	}

	switch (type) {
		case 'schema':
			return undefined;
		case 'error':
			throw new Error(
				`the backup is incomplete: line ${lineNumber} reports an error: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`,
			);
		case 'event':
			return readEventLine(line, payload, lineNumber);
		default:
			throw new Error(`line ${lineNumber} has an unknown type: ${type}`);
	}
};

const readEventLine = (line: string, payload: unknown, lineNumber: number): BackupEntry => {
	const { event, hash } = (typeof payload === 'object' && payload !== null ? payload : {}) as {
		event?: unknown;
		hash?: unknown;
	};

	if (typeof event !== 'object' || event === null) {
		throw new Error(`line ${lineNumber} has an event line without an event`);
	}
	if (typeof hash !== 'string') {
		throw new Error(`line ${lineNumber} has an event line without a hash`);
	}

	const entry: BackupEntry = {
		type: 'event',
		payload: { event: event as CloudEvent, hash },
	};

	entry.payload.originalDataString = getCompactValue(line, ['payload', 'event', 'data']);

	return entry;
};

export const findEventById = (entries: BackupEntry[], eventId: string): BackupEntry | undefined => {
	return entries.find(entry => entry.payload.event.id === eventId);
};
