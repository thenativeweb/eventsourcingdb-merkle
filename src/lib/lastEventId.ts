import { parseEventId } from './eventId.js';
import type { BackupEntry } from './types.js';

// takeEntriesUpTo returns the events of a backup up to the one with the given
// ID, which it includes, so that the Merkle root of an earlier state can be
// calculated again from a backup that has grown since. An ID that the backup
// does not hold is refused rather than taken as the end of the backup, since
// the root would then cover other events than the ones it was meant to.
export const takeEntriesUpTo = (entries: BackupEntry[], lastEventId: string): BackupEntry[] => {
	const last = parseEventId(lastEventId);
	const index =
		last === undefined
			? -1
			: entries.findIndex(entry => parseEventId(entry.payload.event.id) === last);

	if (index === -1) {
		throw new Error(`the backup holds no event with ID ${lastEventId}`);
	}

	return entries.slice(0, index + 1);
};
