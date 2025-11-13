import { Args } from '@oclif/core';
import BaseCommand from '../lib/BaseCommand.js';
import { verifyMerkleProof } from '../lib/merkleTree.js';
import type { MerkleProof } from '../lib/types.js';

export default class VerifyProof extends BaseCommand {
	static override description = 'Verify a Merkle proof';

	static override examples = [
		// biome-ignore lint/security/noSecrets: This is an example command, not a secret
		'<%= config.bin %> <%= command.id %> \'{"eventId":"42","eventHash":"...","siblingHashes":[],"merkleRoot":"..."}\'',
		'<%= config.bin %> <%= command.id %> proof.json',
	];

	static override args = {
		proof: Args.string({
			description: 'Merkle proof as JSON string or path to JSON file',
			required: true,
		}),
	};

	public async run(): Promise<void> {
		const { args } = await this.parse(VerifyProof);

		try {
			let proof: MerkleProof;

			// Try to parse as JSON string first
			try {
				proof = JSON.parse(args.proof) as MerkleProof;
			} catch {
				// If parsing fails, try to read as file
				const { readFileSync } = await import('node:fs');
				const fileContent = readFileSync(args.proof, 'utf-8');
				proof = JSON.parse(fileContent) as MerkleProof;
			}

			// Validate proof structure
			if (!proof.eventHash || !proof.merkleRoot || !proof.siblingHashes) {
				this.log('✗ Invalid proof structure');
				// biome-ignore lint/security/noSecrets: These are field names, not secrets
				this.log('Must contain eventHash, merkleRoot, and siblingHashes');
				process.exitCode = 1;
				return;
			}

			const isValid = verifyMerkleProof(proof);

			if (!isValid) {
				this.log(`✗ Merkle proof is invalid`);
				this.log(`Event ID: ${proof.eventId}`);
				this.log(`Event Hash: ${proof.eventHash}`);
				this.log(`Merkle Root: ${proof.merkleRoot}`);
				process.exitCode = 1;
				return;
			}

			this.log(`✓ Merkle proof is valid`);
			this.log(`Event ID: ${proof.eventId}`);
			this.log(`Event Hash: ${proof.eventHash}`);
			this.log(`Merkle Root: ${proof.merkleRoot}`);
		} catch (error) {
			this.log(
				`✗ Failed to verify Merkle proof: ${error instanceof Error ? error.message : String(error)}`,
			);
			process.exitCode = 1;
		}
	}
}
