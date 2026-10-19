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

// A sibling of a proof of version 1 or 2, and the side of the path on which it
// lies.
export interface SiblingWithSide {
	hash: string;
	position: 'left' | 'right';
}

// A proof of version 1 or 2, whose path follows the sides of its siblings, so
// that it does not bind the ID of its event.
export interface MerkleProofWithSides {
	eventId: string;
	eventHash: string;
	// The salt of the leaf of the event, in hexadecimal, where the leaves of the
	// tree are salted.
	salt?: string;
	siblingHashes: SiblingWithSide[];
	merkleRoot: string;
}

// A proof of version 3, whose path follows from the ID of its event and the ID
// of the last event of the tree, whose size its root covers.
export interface MerkleProofVersion3 {
	eventId: string;
	eventHash: string;
	salt?: string;
	siblingHashes: string[];
	merkleRoot: string;
	lastEventId: string;
}

export type MerkleProof = MerkleProofWithSides | MerkleProofVersion3;
