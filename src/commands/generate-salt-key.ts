import { Flags } from '@oclif/core';
import BaseCommand from '../lib/BaseCommand.js';
import { describeError } from '../lib/describeError.js';
import { writeSaltKey } from '../lib/saltKey.js';

export default class GenerateSaltKey extends BaseCommand {
	static override description = 'Generate a key to salt the leaves of Merkle trees with';

	static override examples = ['<%= config.bin %> <%= command.id %> --output=merkle.key'];

	static override flags = {
		output: Flags.string({
			description: 'File to write the salt key to; an existing file is never overwritten',
			required: true,
		}),
	};

	static override args = {};

	public async run(): Promise<void> {
		const { flags } = await this.parse(GenerateSaltKey);

		try {
			await writeSaltKey(flags.output);

			this.log(`✓ Salt key written to ${flags.output}`);
			this.log(
				'Keep it safe: without it, no further proof can be generated for a root calculated with it.',
			);
		} catch (error) {
			this.log(`✗ Failed to generate salt key: ${describeError(error)}`);
			process.exitCode = 1;
		}
	}
}
