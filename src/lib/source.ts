import { Flags } from '@oclif/core';
import { readBackupFile } from './backupReader.js';
import {
	type ChainEvent,
	findEventById,
	fromBackupEntry,
	fromDatabaseEvent,
} from './chainEvent.js';
import { readDatabase } from './databaseReader.js';
import { parseEventId } from './eventId.js';

// The flags that name where a command reads its events from: a backup, or a
// running database with its API token. The token is taken as a flag only, as
// EventSourcingDB and the other tools around it take it.
export const sourceFlags = {
	backup: Flags.string({ description: 'Path to the backup file' }),
	'esdb-url': Flags.string({ description: 'URL of a running EventSourcingDB to read from' }),
	'esdb-api-token': Flags.string({ description: 'API token of the EventSourcingDB to read from' }),
};

export type Source =
	| { type: 'backup'; filePath: string }
	| { type: 'database'; url: string; apiToken: string };

// getSource returns the source that the flags name, or why they do not name
// exactly one. The messages name the flags, never the token, so that it does
// not end up in a terminal or a log.
export const getSource = (flags: {
	backup?: string;
	'esdb-url'?: string;
	'esdb-api-token'?: string;
}): Source | { refusal: string } => {
	const filePath = flags.backup || undefined;
	const url = flags['esdb-url'] || undefined;
	const apiToken = flags['esdb-api-token'] || undefined;

	if (filePath !== undefined && url !== undefined) {
		return { refusal: '--backup and --esdb-url cannot be used together' };
	}
	if (filePath !== undefined && apiToken !== undefined) {
		return { refusal: '--backup and --esdb-api-token cannot be used together' };
	}
	if (filePath !== undefined) {
		return { type: 'backup', filePath };
	}
	if (url !== undefined) {
		if (apiToken === undefined) {
			return { refusal: '--esdb-api-token is required when using --esdb-url' };
		}

		return { type: 'database', url, apiToken };
	}

	return { refusal: 'Either --backup or --esdb-url must be provided' };
};

// readEvents reads the events of a source, up to the given last event if there
// is one, so that the Merkle root of an earlier state can be calculated again
// from a source that has grown since. A database is asked for those events
// alone, but a bound beyond its latest event reads up to the latest one, so the
// bound is checked against what was read, for either source: a last event that
// the source does not hold is refused rather than taken as the end, since the
// root would then cover other events than the ones it was meant to.
export const readEvents = async (
	source: Source,
	{ lastEventId }: { lastEventId?: string } = {},
): Promise<ChainEvent[]> => {
	const events =
		source.type === 'database'
			? (await readDatabase(source.url, source.apiToken, { lastEventId })).map(fromDatabaseEvent)
			: (await readBackupFile(source.filePath)).map(fromBackupEntry);
	if (lastEventId === undefined) {
		return events;
	}

	const last = parseEventId(lastEventId);
	const index =
		last === undefined ? -1 : events.findIndex(event => parseEventId(event.id) === last);
	if (index === -1) {
		throw new Error(`the ${source.type} holds no event with ID ${lastEventId}`);
	}

	return events.slice(0, index + 1);
};

// readEvent reads the single event with the given ID, or undefined where the
// source does not hold it. A database is asked for that event alone rather than
// for all of them.
export const readEvent = async (
	source: Source,
	eventId: string,
): Promise<ChainEvent | undefined> => {
	if (source.type === 'database') {
		const [event] = await readDatabase(source.url, source.apiToken, { eventId });

		return event === undefined ? undefined : fromDatabaseEvent(event);
	}

	const events = (await readBackupFile(source.filePath)).map(fromBackupEntry);

	return findEventById(events, eventId);
};
