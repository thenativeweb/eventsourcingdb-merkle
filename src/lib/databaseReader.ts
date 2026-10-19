import { Client, type Event, type ReadEventsOptions } from 'eventsourcingdb';
import { parseEventId } from './eventId.js';

// readDatabase reads the events of a running database in the order they were
// written, through the client SDK, up to the given last event if there is one,
// or only the given event. The SDK reads the v2 API where the server offers it,
// whose stream ends with an end item, so that a read cut short fails rather
// than passing as complete; against a server that offers only the v1 API, it
// cannot tell the two apart. An ID goes to the server as the number it names,
// in the notation the server writes, so that every notation reads the same
// event on every server, as it does for a backup.
export const readDatabase = async (
	url: string,
	apiToken: string,
	{ lastEventId, eventId }: { lastEventId?: string; eventId?: string },
): Promise<Event[]> => {
	const options: ReadEventsOptions = { recursive: true };
	if (eventId !== undefined) {
		const id = parseEventId(eventId);
		if (id === undefined) {
			return [];
		}

		options.lowerBound = { id: id.toString(), type: 'inclusive' };
		options.upperBound = { id: id.toString(), type: 'inclusive' };
	} else if (lastEventId !== undefined) {
		const id = parseEventId(lastEventId);
		if (id === undefined) {
			return [];
		}

		options.upperBound = { id: id.toString(), type: 'inclusive' };
	}

	const client = new Client(new URL(url), apiToken);
	const events: Event[] = [];
	for await (const event of client.readEvents('/', options)) {
		events.push(event);
	}

	return events;
};
