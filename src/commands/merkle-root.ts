import { Flags } from '@oclif/core';
import BaseCommand from '../lib/BaseCommand.js';
import { describeError } from '../lib/describeError.js';
import { parseEventId } from '../lib/eventId.js';
import { calculateMerkleRoot } from '../lib/merkleTree.js';
import { getSource, readEvents, sourceFlags } from '../lib/source.js';
import { getTree, getTreeFlags, getTreeHashes, readTreeOptions } from '../lib/tree.js';

export default class MerkleRoot extends BaseCommand {
	static override description =
		'Calculate the Merkle root for an EventSourcingDB backup file or a running EventSourcingDB';

	static override examples = [
		'<%= config.bin %> <%= command.id %> --backup=backup.json',
		'<%= config.bin %> <%= command.id %> --backup=/path/to/backup.json --last-event-id=41',
		'<%= config.bin %> <%= command.id %> --backup=backup.json --salt-key-file=merkle.key',
		'<%= config.bin %> <%= command.id %> --backup=backup.json --tree-version=1',
		'<%= config.bin %> <%= command.id %> --esdb-url=http://localhost:3000 --esdb-api-token="$ESDB_API_TOKEN"',
	];

	static override flags = {
		...sourceFlags,
		'last-event-id': Flags.string({
			description: 'ID of the last event to cover, to calculate the root of an earlier state again',
		}),
		...getTreeFlags('Version of the Merkle tree: 1 for roots that releases before 3.0 calculated'),
	};

	static override args = {};

	public async run(): Promise<void> {
		const { flags } = await this.parse(MerkleRoot);

		const source = getSource(flags);
		if ('refusal' in source) {
			this.refuseCall(source.refusal);
			return;
		}

		const lastEventId = flags['last-event-id'];
		if (lastEventId !== undefined && parseEventId(lastEventId) === undefined) {
			this.refuseCall(`--last-event-id has to be an event ID, but is '${lastEventId}'`);
			return;
		}

		const tree = getTree(flags);
		if ('refusal' in tree) {
			this.refuseCall(tree.refusal);
			return;
		}

		try {
			const treeOptions = await readTreeOptions(tree);
			const events = await readEvents(source, { lastEventId });
			const hashes = getTreeHashes(events, treeOptions);
			const merkleRoot = calculateMerkleRoot(hashes, treeOptions);

			// The ID of the last event is what calculates this root again later,
			// from a source that has grown since.
			this.log(`Merkle Root: ${merkleRoot}`);
			this.log(`Total events: ${events.length}`);
			this.log(`Last event ID: ${events.at(-1)?.id}`);
		} catch (error) {
			this.log(`✗ Failed to calculate Merkle root: ${describeError(error)}`);
			process.exitCode = 1;
		}
	}
}
