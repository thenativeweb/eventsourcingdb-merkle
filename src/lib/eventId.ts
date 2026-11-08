// The largest event ID that EventSourcingDB holds.
const largestEventId = 9_223_372_036_854_775_807n;

// An event ID is written as EventSourcingDB takes it from a client: digits
// alone, without a sign or a leading zero, so that an event has exactly one ID
// as it is written.
const eventIdPattern = /^(0|[1-9][0-9]*)$/u;

// An event ID that a source holds is any integer, a sign and leading zeros
// included, since what an earlier release wrote has to stay readable.
const storedEventIdPattern = /^[+-]?\d+$/u;

export const isEventId = (value: unknown): boolean =>
	typeof value === 'string' && eventIdPattern.test(value);

// parseEventId returns the number that an event ID given to the tool names, or
// undefined for anything that EventSourcingDB would not take as an event ID.
export const parseEventId = (id: string): bigint | undefined => {
	if (!isEventId(id)) {
		return undefined;
	}

	const eventId = BigInt(id);

	return eventId <= largestEventId ? eventId : undefined;
};

// parseStoredEventId returns the number that an event ID in a source names, so
// that IDs in other notations of the same number compare as equal, or undefined
// for text that names no number.
export const parseStoredEventId = (id: string): bigint | undefined => {
	return storedEventIdPattern.test(id) ? BigInt(id) : undefined;
};
