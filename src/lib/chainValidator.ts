import type { ChainEvent } from './chainEvent.js';
import { UnsupportedHashVersionError } from './hash.js';

export interface ChainValidationResult {
	isValid: boolean;
	totalEvents: number;
	errors: Array<{
		eventId: string;
		message: string;
	}>;
}

export const validateChain = (events: ChainEvent[]): ChainValidationResult => {
	const errors: Array<{ eventId: string; message: string }> = [];

	for (const [i, event] of events.entries()) {
		const storedHash = event.hash;

		// Validate hash
		try {
			const { isMatching, calculatedHash } = event.checkHash();
			if (!isMatching) {
				errors.push({
					eventId: event.id,
					message:
						calculatedHash === undefined
							? `Hash mismatch: expected ${storedHash}`
							: `Hash mismatch: expected ${storedHash}, got ${calculatedHash}`,
				});
			}
		} catch (error) {
			errors.push({
				eventId: event.id,
				message:
					error instanceof UnsupportedHashVersionError
						? error.message
						: `Failed to calculate hash: ${error instanceof Error ? error.message : String(error)}`,
			});
		}

		// Validate predecessor hash
		if (i > 0) {
			const previousEvent = events[i - 1];
			const expectedPredecessorHash = previousEvent?.hash;

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
		totalEvents: events.length,
		errors,
	};
};
