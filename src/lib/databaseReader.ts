import { Client, type Event, type ReadEventsOptions } from 'eventsourcingdb';
import { parseEventId } from './eventId.js';

// readDatabase reads the events of a running database in the order they were
// written, through the client SDK, up to the given last event if there is one,
// or only the given event. The SDK reads the v2 API where the server offers it,
// whose stream ends with an end item, so that a read cut short fails rather
// than passing as complete; against a server that offers only the v1 API, it
// cannot tell the two apart. EventSourcingDB reads an ID in any notation of
// its number, as the tool does for a backup.
export const readDatabase = async (
	url: string,
	apiToken: string,
	{ lastEventId, eventId }: { lastEventId?: string; eventId?: string },
): Promise<Event[]> => {
	const options: ReadEventsOptions = { recursive: true };
	if (eventId !== undefined) {
		// An ID that names no number names no event, as for a backup, rather than
		// a request that the server refuses.
		if (parseEventId(eventId) === undefined) {
			return [];
		}

		options.lowerBound = { id: eventId, type: 'inclusive' };
		options.upperBound = { id: eventId, type: 'inclusive' };
	} else if (lastEventId !== undefined) {
		options.upperBound = { id: lastEventId, type: 'inclusive' };
	}

	const client = new Client(new URL(url), apiToken);
	const events: Event[] = [];
	for await (const event of client.readEvents('/', options)) {
		events.push(event);
	}

	return events;
};
