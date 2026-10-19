import { type Event, HashVerificationFailedError } from 'eventsourcingdb';
import { parseEventId } from './eventId.js';
import { assertKnownHashVersion, calculateEventHash } from './hash.js';
import type { BackupEntry, CloudEvent } from './types.js';

export interface HashCheck {
	isMatching: boolean;
	calculatedHash: string | undefined;
}

// A ChainEvent is an event as the chain and the Merkle tree see it, whichever
// source it was read from: its ID, its stored hash, the hash of the event before
// it, and a check of its hash against its content. The check throws an
// UnsupportedHashVersionError for a hash of a version the tool does not know.
export interface ChainEvent {
	id: string;
	hash: string;
	predecessorhash: string;
	checkHash: () => HashCheck;
}

// An event that the tool read from text is hashed by the tool itself, over the
// data as the text holds it, so the hash it calculated is known.
export const fromCloudEvent = (
	event: CloudEvent,
	hash: string,
	originalDataString: string | undefined,
): ChainEvent => {
	return {
		id: event.id,
		hash,
		predecessorhash: event.predecessorhash,
		checkHash: () => {
			const calculatedHash = calculateEventHash(event, originalDataString, hash);

			return { isMatching: calculatedHash === hash, calculatedHash };
		},
	};
};

export const fromBackupEntry = (entry: BackupEntry): ChainEvent => {
	const { event, hash, originalDataString } = entry.payload;

	return fromCloudEvent(event, hash, originalDataString);
};

// An event that the SDK read from a running database verifies its own hash,
// over the data and the time as the server sent them, which it keeps to
// itself, so the hash it calculated is not known.
export const fromDatabaseEvent = (event: Event): ChainEvent => {
	return {
		id: event.id,
		hash: event.hash,
		predecessorhash: event.predecessorhash,
		checkHash: () => {
			assertKnownHashVersion(event.hash);

			try {
				event.verifyHash();
			} catch (error) {
				if (error instanceof HashVerificationFailedError) {
					return { isMatching: false, calculatedHash: undefined };
				}
				throw error;
			}

			return { isMatching: true, calculatedHash: undefined };
		},
	};
};

// findEventById compares IDs as numbers, as EventSourcingDB reads them, so that
// an ID in another notation of the same number finds the event.
export const findEventById = (events: ChainEvent[], eventId: string): ChainEvent | undefined => {
	const wanted = parseEventId(eventId);
	if (wanted === undefined) {
		return undefined;
	}

	return events.find(event => parseEventId(event.id) === wanted);
};
