// An event ID is an integer, which EventSourcingDB reads with an optional sign.
const eventIdPattern = /^[+-]?\d+$/u;

// parseEventId returns the number that an event ID names, so that IDs in other
// notations of the same number compare as equal, or undefined for text that
// names no number.
export const parseEventId = (id: string): bigint | undefined => {
	return eventIdPattern.test(id) ? BigInt(id) : undefined;
};
