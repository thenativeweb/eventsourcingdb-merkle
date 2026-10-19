import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { isObject } from './isObject.js';
import { getCompactValue, getRawValue } from './rawJson.js';
import type { BackupEntry, CloudEvent } from './types.js';

// A line of a backup, of either format: the v1 API writes a payload, the v2 API
// data.
interface BackupLine {
	text: string;
	number: number;
	type: string;
	payload: unknown;
	data: unknown;
}

interface FormatReader {
	readLine: (line: BackupLine) => BackupEntry | undefined;
	finish: () => void;
}

// The event that a part of a backup of the v2 API ended at, or that an
// increment follows on.
interface AnchorEvent {
	id: string;
	hash: string;
}

// The version of the format in which the v2 API writes a backup. The backups
// of the v1 API carry no version of their own.
const backupFormatVersion = 2;

// An event ID is an integer, which EventSourcingDB reads with an optional sign.
const eventIdPattern = /^[+-]?\d+$/u;

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

	let formatReader: FormatReader | undefined;
	let lineNumber = 0;
	for await (const text of rl) {
		lineNumber++;

		if (text.trim() === '') {
			continue;
		}

		const line = parseLine(text, lineNumber);

		// A server sends heartbeats while it reads a large store, and they carry
		// nothing to verify.
		if (line.type === 'heartbeat') {
			continue;
		}

		// A backup that the v1 API wrote begins with a line of its own rather than
		// with a backup line, and holds payloads rather than data, which is how
		// the restore of EventSourcingDB tells the two formats apart as well.
		formatReader ??=
			line.type !== 'backup' && line.payload !== undefined ? createV1Reader() : createV2Reader();

		const entry = formatReader.readLine(line);
		if (entry !== undefined) {
			entries.push(entry);
		}
	}

	formatReader?.finish();

	return entries;
};

const parseLine = (text: string, lineNumber: number): BackupLine => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`line ${lineNumber} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const { type, payload, data } = isObject(parsed) ? parsed : {};

	if (typeof type !== 'string') {
		throw new Error(`line ${lineNumber} has no type`);
	}

	return { text, number: lineNumber, type, payload, data };
};

// A backup of the v1 API holds a line for every schema, which neither the hashes
// nor the chain cover, and a line for every event. Every other line ends the
// reading: an error line means that the backup was cut short, and a line of a
// type the format does not know means that the file is no backup the tool can
// read. Skipping either would let the events before it pass as a complete,
// valid chain.
const createV1Reader = (): FormatReader => {
	return {
		readLine: line => {
			switch (line.type) {
				case 'schema':
					return undefined;
				case 'error':
					throw new Error(
						`the backup is incomplete: line ${line.number} reports an error: ${typeof line.payload === 'string' ? line.payload : JSON.stringify(line.payload)}`,
					);
				case 'event':
					return readV1EventLine(line);
				default:
					throw new Error(`line ${line.number} has an unknown type: ${line.type}`);
			}
		},
		finish: () => {
			// The format has no line that ends it, so a backup that was cut short
			// without an error line cannot be told from a complete one.
		},
	};
};

const readV1EventLine = (line: BackupLine): BackupEntry => {
	const { event, hash } = isObject(line.payload) ? line.payload : {};

	if (!isObject(event)) {
		throw new Error(`line ${line.number} has an event line without an event`);
	}
	if (typeof hash !== 'string') {
		throw new Error(`line ${line.number} has an event line without a hash`);
	}

	return {
		type: 'event',
		payload: {
			event: event as unknown as CloudEvent,
			hash,
			originalDataString: getCompactValue(line.text, ['payload', 'event', 'data']),
		},
	};
};

// A backup of the v2 API is a sequence of parts in one file: a full backup,
// followed by any number of increments, each beginning with a backup line and
// ending with an end line, as the restore of EventSourcingDB takes them. An
// increment follows on the event that the part before it ended at, so across
// the parts the chain is the ordinary chain of the events. The reader checks the
// structure as the restore does, since a backup that the restore refuses holds
// no chain that could be restored, but leaves the values of the events and the
// schemas to the restore, which checks them with the rules of the server.
const createV2Reader = (): FormatReader => {
	let partIndex = -1;
	let isPartOpen = false;
	let hasPartEvents = false;
	let endedAt: AnchorEvent | undefined;

	const readBackupLine = (line: BackupLine): undefined => {
		if (isPartOpen) {
			throw new Error(`line ${line.number} begins a part before the part before it ended`);
		}

		const { lastBackedUpEvent } = isObject(line.data) ? line.data : {};
		partIndex++;

		// The restore reads the version as the text of a number, so it takes one
		// in quotes as well, and counts null as a version that is left out.
		const rawFormatVersion = getRawValue(line.text, ['data', 'formatVersion']);
		const formatVersion =
			rawFormatVersion === undefined || rawFormatVersion === 'null'
				? undefined
				: rawFormatVersion.startsWith('"')
					? (JSON.parse(rawFormatVersion) as string)
					: rawFormatVersion;

		if (formatVersion !== String(backupFormatVersion)) {
			throw new Error(
				`line ${line.number} has an unsupported backup format version: ${formatVersion ?? 'none'}`,
			);
		}

		// The first part is a full backup, and every later one follows on the event
		// the part before it ended at, or on its anchor, where it held no event.
		if (partIndex === 0 && lastBackedUpEvent !== null && lastBackedUpEvent !== undefined) {
			throw new Error(
				`line ${line.number} begins an increment, but a backup has to begin with a full backup`,
			);
		}
		if (partIndex > 0 && !isSameEvent(lastBackedUpEvent, endedAt)) {
			throw new Error(
				`line ${line.number} begins an increment that does not follow on the part before it`,
			);
		}

		isPartOpen = true;
		hasPartEvents = false;

		return undefined;
	};

	const readEventLine = (line: BackupLine): BackupEntry => {
		if (!isObject(line.data)) {
			throw new Error(`line ${line.number} has an event line without an event`);
		}

		const { hash } = line.data;
		if (typeof hash !== 'string') {
			throw new Error(`line ${line.number} has an event line without a hash`);
		}

		const event = line.data as unknown as CloudEvent;
		hasPartEvents = true;
		endedAt = { id: event.id, hash };

		return {
			type: 'event',
			payload: {
				event,
				hash,
				originalDataString: getCompactValue(line.text, ['data', 'data']),
			},
		};
	};

	return {
		readLine: line => {
			if (!isPartOpen && line.type !== 'backup') {
				throw new Error(
					`line ${line.number} has to begin a part with a backup line, but has the type ${line.type}`,
				);
			}

			switch (line.type) {
				case 'backup':
					return readBackupLine(line);
				case 'eventSchema':
					if (hasPartEvents) {
						throw new Error(`line ${line.number} holds a schema after the events of its part`);
					}
					return undefined;
				case 'event':
					return readEventLine(line);
				case 'lastBackedUpEvent':
					// The event a part ended at follows from its events or its anchor
					// already, so the line that names it adds nothing to check.
					return undefined;
				case 'error': {
					const { description } = isObject(line.data) ? line.data : {};
					throw new Error(
						`the backup is incomplete: line ${line.number} reports an error: ${typeof description === 'string' ? description : JSON.stringify(line.data)}`,
					);
				}
				case 'end':
					isPartOpen = false;
					return undefined;
				default:
					throw new Error(`line ${line.number} has an unknown type: ${line.type}`);
			}
		},
		finish: () => {
			if (isPartOpen) {
				throw new Error(`the backup is incomplete: part ${partIndex} lacks its end line`);
			}
		},
	};
};

// isSameEvent tells whether the anchor that an increment names, as its backup
// line holds it, is the event that the part before it ended at, by its ID as a
// number, since creating a backup takes the ID in any notation that
// EventSourcingDB reads, and by its hash. An anchor of null names no event, and
// follows on a part that ended at none, such as a full backup of an empty store.
// Any other anchor that does not name an event by its ID and hash follows on
// nothing.
const isSameEvent = (anchor: unknown, endedAt: AnchorEvent | undefined): boolean => {
	if (anchor === null || anchor === undefined) {
		return endedAt === undefined;
	}
	if (endedAt === undefined || !isObject(anchor)) {
		return false;
	}

	const { id, hash } = anchor;
	if (typeof id !== 'string' || typeof hash !== 'string') {
		return false;
	}
	if (!eventIdPattern.test(id) || !eventIdPattern.test(endedAt.id)) {
		return false;
	}

	return BigInt(id) === BigInt(endedAt.id) && hash === endedAt.hash;
};

export const findEventById = (entries: BackupEntry[], eventId: string): BackupEntry | undefined => {
	return entries.find(entry => entry.payload.event.id === eventId);
};
