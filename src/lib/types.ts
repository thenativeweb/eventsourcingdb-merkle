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
		// The original JSON string of the event data as it appears in the
		// backup file. This is needed because the backup may contain Unicode
		// escape sequences (e.g., \u003e for >) that are not preserved by
		// JSON.parse() + JSON.stringify(). To verify hashes correctly, we must
		// use the exact original string representation. Only present when
		// reading from a backup file, not when creating events manually.
		originalDataString?: string;
	};
}

export interface MerkleProof {
	eventId: string;
	eventHash: string;
	siblingHashes: Array<{
		hash: string;
		position: 'left' | 'right';
	}>;
	merkleRoot: string;
}
