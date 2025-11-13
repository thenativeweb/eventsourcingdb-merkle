import { Args } from '@oclif/core';
import BaseCommand from '../lib/BaseCommand.js';
import { readBackupFile } from '../lib/backupReader.js';
import { validateChain } from '../lib/chainValidator.js';

export default class ValidateChain extends BaseCommand {
	static override description = 'Validate the hash chain in an EventSourcingDB backup file';

	static override examples = [
		'<%= config.bin %> <%= command.id %> backup.json',
		'<%= config.bin %> <%= command.id %> /path/to/backup.json',
	];

	static override args = {
		file: Args.string({ description: 'Path to the backup file', required: true }),
	};

	public async run(): Promise<void> {
		const { args } = await this.parse(ValidateChain);

		try {
			const entries = await readBackupFile(args.file);
			const result = validateChain(entries);

			if (!result.isValid) {
				this.log(`✗ Chain validation failed`);
				this.log(`Total events: ${result.totalEvents}`);
				this.log(`Errors found: ${result.errors.length}`);
				this.log('');

				for (const error of result.errors) {
					this.log(`Event ${error.eventId}: ${error.message}`);
				}

				process.exitCode = 1;
				return;
			}

			this.log(`✓ Chain is valid (${result.totalEvents} events)`);
		} catch (error) {
			this.log(
				`✗ Failed to validate chain: ${error instanceof Error ? error.message : String(error)}`,
			);
			process.exitCode = 1;
		}
	}
}
