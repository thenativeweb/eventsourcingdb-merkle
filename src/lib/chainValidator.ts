import { calculateEventHash } from './hash.js';
import type { BackupEntry } from './types.js';

export interface ChainValidationResult {
	isValid: boolean;
	totalEvents: number;
	errors: Array<{
		eventId: string;
		message: string;
	}>;
}

export const validateChain = (entries: BackupEntry[]): ChainValidationResult => {
	const errors: Array<{ eventId: string; message: string }> = [];

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		const event = entry.payload.event;
		const storedHash = entry.payload.hash;

		// Validate hash
		try {
			const calculatedHash = calculateEventHash(event, entry.payload.originalDataString);
			if (calculatedHash !== storedHash) {
				errors.push({
					eventId: event.id,
					message: `Hash mismatch: expected ${storedHash}, got ${calculatedHash}`,
				});
			}
		} catch (error) {
			errors.push({
				eventId: event.id,
				message: `Failed to calculate hash: ${error instanceof Error ? error.message : String(error)}`,
			});
		}

		// Validate predecessor hash
		if (i > 0) {
			const previousEntry = entries[i - 1];
			const expectedPredecessorHash = previousEntry.payload.hash;

			if (event.predecessorhash !== expectedPredecessorHash) {
				errors.push({
					eventId: event.id,
					message: `Predecessor hash mismatch: expected ${expectedPredecessorHash}, got ${event.predecessorhash}`,
				});
			}
		} else {
			// First event should have null predecessor
			const nullHash = '0'.repeat(64);
			if (event.predecessorhash !== nullHash) {
				errors.push({
					eventId: event.id,
					message: `First event should have null predecessor hash, got ${event.predecessorhash}`,
				});
			}
		}
	}

	return {
		isValid: errors.length === 0,
		totalEvents: entries.length,
		errors,
	};
};
