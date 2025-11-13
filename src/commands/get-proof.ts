import { Args, Flags } from '@oclif/core';
import BaseCommand from '../lib/BaseCommand.js';
import { findEventById, readBackupFile } from '../lib/backupReader.js';
import { generateMerkleProof } from '../lib/merkleTree.js';
import type { MerkleProof } from '../lib/types.js';

export default class GetProof extends BaseCommand {
	static override description = 'Generate a Merkle proof for a specific event';

	static override examples = [
		'<%= config.bin %> <%= command.id %> backup.json 42',
		'<%= config.bin %> <%= command.id %> /path/to/backup.json 0 --json',
	];

	static override args = {
		file: Args.string({ description: 'Path to the backup file', required: true }),
		'event-id': Args.string({ description: 'Event ID to generate proof for', required: true }),
	};

	static override flags = {
		json: Flags.boolean({ description: 'Output proof as JSON' }),
	};

	public async run(): Promise<void> {
		const { args, flags } = await this.parse(GetProof);

		try {
			const entries = await readBackupFile(args.file);
			const entry = findEventById(entries, args['event-id']);

			if (!entry) {
				this.log(`✗ Event with ID ${args['event-id']} not found`);
				process.exitCode = 1;
				return;
			}

			const hashes = entries.map(e => e.payload.hash);
			const proofData = generateMerkleProof(hashes, entry.payload.hash);

			const proof: MerkleProof = {
				eventId: entry.payload.event.id,
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
