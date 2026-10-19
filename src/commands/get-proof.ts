import { Flags } from '@oclif/core';
import BaseCommand from '../lib/BaseCommand.js';
import { findEventById } from '../lib/chainEvent.js';
import { parseEventId } from '../lib/eventId.js';
import { generateMerkleProof } from '../lib/merkleTree.js';
import { getSource, readEvents, sourceFlags } from '../lib/source.js';
import type { MerkleProof } from '../lib/types.js';

export default class GetProof extends BaseCommand {
	static override description =
		'Generate a Merkle proof for a specific event of an EventSourcingDB backup file or a running EventSourcingDB';

	static override examples = [
		'<%= config.bin %> <%= command.id %> --backup=backup.json --event-id=42',
		'<%= config.bin %> <%= command.id %> --backup=/path/to/backup.json --event-id=0 --json',
		'<%= config.bin %> <%= command.id %> --backup=backup.json --event-id=42 --last-event-id=1234566',
	];

	static override flags = {
		...sourceFlags,
		'event-id': Flags.string({ description: 'Event ID to generate proof for' }),
		'last-event-id': Flags.string({
			description:
				'ID of the last event the root covers, to prove against the root of an earlier state',
		}),
		json: Flags.boolean({ description: 'Output proof as JSON' }),
	};

	static override args = {};

	public async run(): Promise<void> {
		const { flags } = await this.parse(GetProof);

		const source = getSource(flags);
		if ('refusal' in source) {
			this.refuseCall(source.refusal);
			return;
		}

		const eventId = flags['event-id'];
		if (!eventId) {
			this.refuseCall('--event-id is required when using --backup or --esdb-url');
			return;
		}

		const lastEventId = flags['last-event-id'];
		if (lastEventId !== undefined && parseEventId(lastEventId) === undefined) {
			this.refuseCall(`--last-event-id has to be an event ID, but is '${lastEventId}'`);
			return;
		}

		try {
			const events = await readEvents(source, { lastEventId });

			// An event after the last one is not part of the tree, so it has no
			// proof against its root, although the source holds it.
			const eventNumber = parseEventId(eventId);
			const lastEventNumber = lastEventId === undefined ? undefined : parseEventId(lastEventId);
			if (
				eventNumber !== undefined &&
				lastEventNumber !== undefined &&
				eventNumber > lastEventNumber
			) {
				this.log(`✗ Event ${eventId} lies beyond the last event ID ${lastEventId}`);
				process.exitCode = 1;
				return;
			}

			const event = findEventById(events, eventId);

			if (!event) {
				this.log(`✗ Event with ID ${eventId} not found`);
				process.exitCode = 1;
				return;
			}

			const hashes = events.map(e => e.hash);
			const proofData = generateMerkleProof(hashes, event.hash);

			const proof: MerkleProof = {
				eventId: event.id,
				...proofData,
			};

			if (flags.json) {
				this.log(JSON.stringify(proof, null, 2));
				return;
			}

			this.log(`Merkle Proof for Event ${proof.eventId}`);
			this.log('');
			this.log(`Event Hash: ${proof.eventHash}`);
			this.log(`Merkle Root: ${proof.merkleRoot}`);
			this.log('');
			this.log(`Sibling Hashes (${proof.siblingHashes.length}):`);

			for (const [index, sibling] of proof.siblingHashes.entries()) {
				this.log(`  ${index + 1}. ${sibling.hash} (${sibling.position})`);
			}
		} catch (error) {
			this.log(
				`✗ Failed to generate Merkle proof: ${error instanceof Error ? error.message : String(error)}`,
			);
			process.exitCode = 1;
		}
	}
}
