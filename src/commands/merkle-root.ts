import { Flags } from '@oclif/core';
import BaseCommand from '../lib/BaseCommand.js';
import { readBackupFile } from '../lib/backupReader.js';
import { takeEntriesUpTo } from '../lib/lastEventId.js';
import { buildMerkleRoot } from '../lib/merkleTree.js';

export default class MerkleRoot extends BaseCommand {
	static override description = 'Calculate the Merkle root for an EventSourcingDB backup file';

	static override examples = [
		'<%= config.bin %> <%= command.id %> --backup=backup.json',
		'<%= config.bin %> <%= command.id %> --backup=/path/to/backup.json --last-event-id=41',
	];

	static override flags = {
		backup: Flags.string({ description: 'Path to the backup file' }),
		'last-event-id': Flags.string({
			description: 'ID of the last event to cover, to calculate the root of an earlier state again',
		}),
	};

	static override args = {};

	public async run(): Promise<void> {
		const { flags } = await this.parse(MerkleRoot);

		if (!flags.backup) {
			this.log('✗ --backup must be provided');
			this.log('See more help with --help');
			process.exitCode = 2;
			return;
		}

		try {
			const allEntries = await readBackupFile(flags.backup);
			const entries =
				flags['last-event-id'] === undefined
					? allEntries
					: takeEntriesUpTo(allEntries, flags['last-event-id']);
			const hashes = entries.map(entry => entry.payload.hash);
			const merkleRoot = buildMerkleRoot(hashes);

			// The ID of the last event is what calculates this root again later,
			// from a backup that has grown since.
			this.log(`Merkle Root: ${merkleRoot}`);
			this.log(`Total events: ${entries.length}`);
			this.log(`Last event ID: ${entries.at(-1)?.payload.event.id}`);
		} catch (error) {
			this.log(
				`✗ Failed to calculate Merkle root: ${error instanceof Error ? error.message : String(error)}`,
			);
			process.exitCode = 1;
		}
	}
}
