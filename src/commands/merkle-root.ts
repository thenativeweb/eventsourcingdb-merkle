import { Args } from '@oclif/core';
import BaseCommand from '../lib/BaseCommand.js';
import { readBackupFile } from '../lib/backupReader.js';
import { buildMerkleRoot } from '../lib/merkleTree.js';

export default class MerkleRoot extends BaseCommand {
	static override description = 'Calculate the Merkle root for an EventSourcingDB backup file';

	static override examples = [
		'<%= config.bin %> <%= command.id %> backup.json',
		'<%= config.bin %> <%= command.id %> /path/to/backup.json',
	];

	static override args = {
		file: Args.string({ description: 'Path to the backup file', required: true }),
	};

	public async run(): Promise<void> {
		const { args } = await this.parse(MerkleRoot);

		try {
			const entries = await readBackupFile(args.file);
			const hashes = entries.map(entry => entry.payload.hash);
			const merkleRoot = buildMerkleRoot(hashes);

			this.log(`Merkle Root: ${merkleRoot}`);
			this.log(`Total events: ${entries.length}`);
		} catch (error) {
			this.log(
				`✗ Failed to calculate Merkle root: ${error instanceof Error ? error.message : String(error)}`,
			);
			process.exitCode = 1;
		}
	}
}
