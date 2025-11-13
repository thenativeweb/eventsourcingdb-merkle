import crypto from 'node:crypto';
import type { CloudEvent } from './types.js';

export const calculateEventHash = (event: CloudEvent, originalDataString?: string): string => {
	const metadata = `${event.specversion}|${event.id}|${event.predecessorhash}|${event.time}|${event.source}|${event.subject}|${event.type}|${event.datacontenttype}`;

	const metadataHash = crypto.createHash('sha256').update(metadata).digest('hex');

	// Use original data string if available to preserve Unicode escapes
	const dataString = originalDataString ?? JSON.stringify(event.data);
	const dataHash = crypto.createHash('sha256').update(dataString).digest('hex');

	const finalHash = crypto.createHash('sha256').update(`${metadataHash}${dataHash}`).digest('hex');

	return finalHash;
};

export const hashPair = (left: string, right: string): string => {
	return crypto.createHash('sha256').update(`${left}${right}`).digest('hex');
};
