import BaseCommand from '../lib/BaseCommand.js';
import { validateChain } from '../lib/chainValidator.js';
import { getSource, readEvents, sourceFlags } from '../lib/source.js';

export default class ValidateChain extends BaseCommand {
	static override description =
		'Validate the hash chain in an EventSourcingDB backup file or a running EventSourcingDB';

	static override examples = [
		'<%= config.bin %> <%= command.id %> --backup=backup.json',
		'<%= config.bin %> <%= command.id %> --esdb-url=http://localhost:3000 --esdb-api-token="$ESDB_API_TOKEN"',
	];

	static override flags = {
		...sourceFlags,
	};

	static override args = {};

	public async run(): Promise<void> {
		const { flags } = await this.parse(ValidateChain);

		const source = getSource(flags);
		if ('refusal' in source) {
			this.refuseCall(source.refusal);
			return;
		}

		try {
			const events = await readEvents(source);
			const result = validateChain(events);

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
