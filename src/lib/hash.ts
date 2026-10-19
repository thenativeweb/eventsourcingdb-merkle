import crypto from 'node:crypto';
import type { CloudEvent } from './types.js';

// A hash that names its version starts with this prefix. A hash without it is
// of version 1, which predates the prefix.
const hashPrefix = 'esdb:hash:';
const hashVersion2Prefix = `${hashPrefix}v2:`;

// The input of a hash of version 2 writes a field that the event does not have
// as this, which no value of such a field can be.
const missingField = '-';

export class UnsupportedHashVersionError extends Error {
	public readonly version: string;

	public constructor(version: string) {
		super(`Unsupported hash version: ${version}`);
		this.name = 'UnsupportedHashVersionError';
		this.version = version;
	}
}

const getSha256 = (input: string): string => {
	return crypto.createHash('sha256').update(input).digest('hex');
};

// The hash of version 1 covers neither traceparent nor tracestate.
const calculateEventHashOfVersion1 = (event: CloudEvent, dataString: string): string => {
	const metadata = `${event.specversion}|${event.id}|${event.predecessorhash}|${event.time}|${event.source}|${event.subject}|${event.type}|${event.datacontenttype}`;

	return getSha256(`${getSha256(metadata)}${getSha256(dataString)}`);
};

// The hash of version 2 covers the prefix and every field, each on a line of its
// own, without a final line break, as EventSourcingDB computes it.
const calculateEventHashOfVersion2 = (event: CloudEvent, dataString: string): string => {
	const input = [
		hashVersion2Prefix,
		event.specversion,
		event.id,
		event.predecessorhash,
		event.time,
		event.source,
		event.subject,
		event.type,
		event.datacontenttype,
		event.traceparent ?? missingField,
		event.tracestate ?? missingField,
		dataString,
	].join('\n');

	return `${hashVersion2Prefix}${getSha256(input)}`;
};

// calculateEventHash computes the hash of an event in the version that its
// stored hash names, since an event keeps the version of the hash it was
// written with, or in version 1 without a stored hash to go by. A stored hash
// whose prefix names a version that the tool does not know cannot be verified,
// which is not the same as being tampered with, so it is refused rather than
// computed in another version that could only fail to match.
export const calculateEventHash = (
	event: CloudEvent,
	originalDataString?: string,
	storedHash?: string,
): string => {
	const dataString = originalDataString ?? JSON.stringify(event.data);

	if (storedHash === undefined || !storedHash.startsWith(hashPrefix)) {
		return calculateEventHashOfVersion1(event, dataString);
	}
	if (storedHash.startsWith(hashVersion2Prefix)) {
		return calculateEventHashOfVersion2(event, dataString);
	}

	const [version = ''] = storedHash.slice(hashPrefix.length).split(':');
	throw new UnsupportedHashVersionError(version);
};

export const hashPair = (left: string, right: string): string => {
	return crypto.createHash('sha256').update(`${left}${right}`).digest('hex');
};
