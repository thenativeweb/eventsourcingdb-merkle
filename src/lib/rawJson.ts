// The hash of an event covers its data exactly as EventSourcingDB wrote it, so
// the data has to be taken from the text of a line rather than from what
// JSON.parse makes of it: parsing and serializing again changes escape
// sequences, the notation of numbers, and integers beyond 2^53. The text has
// been checked by JSON.parse before, so these functions rely on it being valid
// JSON, and only keep track of where each value begins and ends.

// getRawValue returns the text of the value that the given path of members
// leads to, as it appears in the given JSON text, or undefined if a member of
// the path is missing, or a value on the path is no object.
export const getRawValue = (json: string, path: string[]): string | undefined => {
	let start = skipWhitespace(json, 0);
	let end = getEndOfValue(json, start);

	for (const key of path) {
		const member = findMember(json, start, key);
		if (member === undefined) {
			return undefined;
		}

		({ start, end } = member);
	}

	return json.slice(start, end);
};

// findMember returns where the value of the member with the given key begins
// and ends, in the object that begins at the given position. Of several members
// with the same key, it takes the last one, as JSON.parse does.
const findMember = (
	json: string,
	objectStart: number,
	key: string,
): { start: number; end: number } | undefined => {
	if (json[objectStart] !== '{') {
		return undefined;
	}

	let member: { start: number; end: number } | undefined;
	let position = skipWhitespace(json, objectStart + 1);

	while (position < json.length && json[position] !== '}') {
		const keyEnd = getEndOfString(json, position);
		const memberKey = JSON.parse(json.slice(position, keyEnd)) as string;

		// What follows the key is a colon, as the text is valid JSON.
		const valueStart = skipWhitespace(json, skipWhitespace(json, keyEnd) + 1);
		const valueEnd = getEndOfValue(json, valueStart);
		if (memberKey === key) {
			member = { start: valueStart, end: valueEnd };
		}

		// What follows the value is a comma or the end of the object.
		position = skipWhitespace(json, valueEnd);
		if (json[position] === ',') {
			position = skipWhitespace(json, position + 1);
		}
	}

	return member;
};

const whitespace = new Set([' ', '\t', '\n', '\r']);

// A number or one of the literals true, false, and null ends where the next
// token or whitespace begins.
const endsOfScalar = new Set([',', '}', ']', ...whitespace]);

const getEndOfValue = (json: string, start: number): number => {
	switch (json[start]) {
		case '"':
			return getEndOfString(json, start);
		case '{':
		case '[':
			return getEndOfContainer(json, start);
		default:
			return getEndOfScalar(json, start);
	}
};

const getEndOfString = (json: string, start: number): number => {
	let position = start + 1;

	while (position < json.length && json[position] !== '"') {
		// A backslash escapes the character after it, which may be a quote.
		position += json[position] === '\\' ? 2 : 1;
	}

	return position + 1;
};

const getEndOfContainer = (json: string, start: number): number => {
	let depth = 0;
	let position = start;

	while (position < json.length) {
		const character = json[position];

		if (character === '"') {
			position = getEndOfString(json, position);
			continue;
		}

		if (character === '{' || character === '[') {
			depth++;
		}
		if (character === '}' || character === ']') {
			depth--;
			if (depth === 0) {
				return position + 1;
			}
		}

		position++;
	}

	return position;
};

const getEndOfScalar = (json: string, start: number): number => {
	let position = start;

	while (position < json.length && !endsOfScalar.has(json[position] ?? '')) {
		position++;
	}

	return position;
};

const skipWhitespace = (json: string, start: number): number => {
	let position = start;

	while (position < json.length && whitespace.has(json[position] ?? '')) {
		position++;
	}

	return position;
};
