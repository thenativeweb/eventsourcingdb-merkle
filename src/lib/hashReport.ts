// describeHashMismatch names an event whose hash does not match its content.
// Where the hash was calculated by the client SDK rather than by the tool, the
// SDK keeps it to itself, so only the stored hash is named.
export const describeHashMismatch = (
	event: { id: string; hash: string },
	calculatedHash: string | undefined,
): string[] => {
	if (calculatedHash === undefined) {
		return ['✗ Hash mismatch', `Event ID: ${event.id}`, `Stored hash: ${event.hash}`];
	}

	return [
		'✗ Hash mismatch',
		`Event ID: ${event.id}`,
		`Stored hash:     ${event.hash}`,
		`Calculated hash: ${calculatedHash}`,
	];
};
