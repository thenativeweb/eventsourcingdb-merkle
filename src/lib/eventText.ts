import { getCompactValue } from './rawJson.js';
import type { CloudEvent } from './types.js';

export interface EventFromText {
	event: CloudEvent;
	storedHash: string | undefined;
	originalDataString: string | undefined;
}

const isObject = (value: unknown): value is Record<string, unknown> => {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isEvent = (value: unknown): value is CloudEvent & { hash?: unknown } => {
	return isObject(value) && typeof value.specversion === 'string';
};

// readEventText reads an event from text in every form one can copy it from:
// a line of a backup of the v1 API, which holds the event and its hash side by
// side, a line of read-events of the v1 API, which holds the event with its
// hash, a line of a backup or of read-events of the v2 API, which holds the
// event with its hash as data, or the event alone, with its hash or without. The data is taken from the text
// rather than from what JSON.parse makes of it, since the hash covers it as
// EventSourcingDB wrote it. Text in any other form gives undefined, a line
// whose payload is neither of the two included, since a line carries no spec
// version of its own and so is never taken for an event alone.
export const readEventText = (text: string): EventFromText | undefined => {
	const parsed: unknown = JSON.parse(text);

	if (isObject(parsed) && parsed.type === 'event' && isObject(parsed.payload)) {
		const { payload } = parsed;

		if (isEvent(payload.event) && typeof payload.hash === 'string') {
			return {
				event: payload.event,
				storedHash: payload.hash,
				originalDataString: getCompactValue(text, ['payload', 'event', 'data']),
			};
		}
		if (isEvent(payload) && typeof payload.hash === 'string') {
			return {
				event: payload,
				storedHash: payload.hash,
				originalDataString: getCompactValue(text, ['payload', 'data']),
			};
		}
	}

	if (isObject(parsed) && parsed.type === 'event' && isEvent(parsed.data)) {
		const { data } = parsed;

		if (typeof data.hash === 'string') {
			return {
				event: data,
				storedHash: data.hash,
				originalDataString: getCompactValue(text, ['data', 'data']),
			};
		}
	}

	if (isEvent(parsed)) {
		return {
			event: parsed,
			storedHash: typeof parsed.hash === 'string' ? parsed.hash : undefined,
			originalDataString: getCompactValue(text, ['data']),
		};
	}

	return undefined;
};
