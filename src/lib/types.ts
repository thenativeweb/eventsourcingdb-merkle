export interface CloudEvent {
	specversion: string;
	id: string;
	time: string;
	source: string;
	subject: string;
	type: string;
	datacontenttype: string;
	data: Record<string, unknown>;
	predecessorhash: string;
	traceparent?: string;
	tracestate?: string;
}

export interface BackupEntry {
	type: 'event';
	payload: {
		event: CloudEvent;
		hash: string;
		// The data of the event exactly as it appears in the text it was read
		// from, which the hash covers. JSON.parse() followed by JSON.stringify()
		// does not give it back: escape sequences such as \u003e for >, the
		// notation of numbers, and integers beyond 2^53 change. Only present
		// where the event was read from text, not where it was created as an
		// object.
		originalDataString?: string;
	};
}

export interface MerkleProof {
	eventId: string;
	eventHash: string;
	// The salt of the leaf of the event, in hexadecimal, where the leaves of the
	// tree are salted.
	salt?: string;
	siblingHashes: Array<{
		hash: string;
		position: 'left' | 'right';
	}>;
	merkleRoot: string;
}
