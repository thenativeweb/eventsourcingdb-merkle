import { Client, type Event, type ReadEventsOptions } from 'eventsourcingdb';
import { parseEventId } from './eventId.js';

// readDatabase reads every event of a running database in the order they were
// written, through the client SDK, up to the given last event if there is one,
// or only the given event. The SDK reads the v2 API where the server offers it,
// whose stream ends with an end item, so that a read cut short fails rather
// than passing as complete; against a server that offers only the v1 API, it
// cannot tell the two apart.
export const readDatabase = async (
	url: string,
	apiToken: string,
	{ lastEventId, eventId }: { lastEventId?: string; eventId?: string },
): Promise<Event[]> => {
	const client = new Client(new URL(url), apiToken);
	const options: ReadEventsOptions = { recursive: true };
	if (eventId !== undefined) {
		options.lowerBound = { id: eventId, type: 'inclusive' };
		options.upperBound = { id: eventId, type: 'inclusive' };
	} else if (lastEventId !== undefined) {
		options.upperBound = { id: lastEventId, type: 'inclusive' };
	}

	const events: Event[] = [];
	for await (const event of client.readEvents('/', options)) {
		events.push(event);
	}

	// A bound beyond the latest event reads up to the latest one, so the bound
	// is checked against what was read, as it is for a backup.
	if (lastEventId !== undefined) {
		const lastEvent = events.at(-1);
		if (lastEvent === undefined || parseEventId(lastEvent.id) !== parseEventId(lastEventId)) {
			throw new Error(`the database holds no event with ID ${lastEventId}`);
		}
	}

	return events;
};
