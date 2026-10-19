import { Flags } from '@oclif/core';
import BaseCommand from '../lib/BaseCommand.js';
import { type ChainEvent, fromCloudEvent } from '../lib/chainEvent.js';
import { describeError } from '../lib/describeError.js';
import { readEventText } from '../lib/eventText.js';
import { calculateEventHashInEveryVersion, UnsupportedHashVersionError } from '../lib/hash.js';
import { describeHashMismatch } from '../lib/hashReport.js';
import { getSource, readEvent, sourceFlags } from '../lib/source.js';

export default class ValidateEventHash extends BaseCommand {
	static override description =
		'Validate the hash of a specific event, from a backup file, a running EventSourcingDB, or JSON';

	static override examples = [
		'<%= config.bin %> <%= command.id %> --backup=backup.json --event-id=42',
		'<%= config.bin %> <%= command.id %> --esdb-url=http://localhost:3000 --esdb-api-token="$ESDB_API_TOKEN" --event-id=42',
		// biome-ignore lint/security/noSecrets: This is an example command, not a secret
		'<%= config.bin %> <%= command.id %> --event=\'{"specversion":"1.0",...}\'',
	];

	static override flags = {
		...sourceFlags,
		'event-id': Flags.string({
			description: 'Event ID to validate (requires --backup or --esdb-url)',
		}),
		event: Flags.string({
			description: 'JSON string of the event to validate',
			exclusive: ['backup', 'esdb-url', 'event-id'],
		}),
	};

	static override args = {};

	public async run(): Promise<void> {
		const { flags } = await this.parse(ValidateEventHash);
		const eventId = flags['event-id'];

		if (!flags.backup && !flags['esdb-url'] && !flags.event) {
			this.refuseCall('Either --backup or --esdb-url with --event-id, or --event must be provided');
			return;
		}

		// The token is checked here rather than by oclif, whose message would name
		// its value.
		if (flags.event && flags['esdb-api-token']) {
			this.refuseCall('--event and --esdb-api-token cannot be used together');
			return;
		}

		try {
			let event: ChainEvent;

			if (flags.event) {
				const eventFromText = readEventText(flags.event);

				if (eventFromText === undefined) {
					this.refuseCall('--event is neither an event nor a line of a backup or of read-events');
					return;
				}

				// Without a stored hash, nothing tells which version of the hash is
				// meant, so it is calculated in every version.
				if (eventFromText.storedHash === undefined) {
					for (const { version, hash } of calculateEventHashInEveryVersion(
						eventFromText.event,
						eventFromText.originalDataString,
					)) {
						this.log(`Calculated hash (version ${version}): ${hash}`);
					}
					return;
				}

				event = fromCloudEvent(
					eventFromText.event,
					eventFromText.storedHash,
					eventFromText.originalDataString,
				);
			} else {
				const source = getSource(flags);
				if ('refusal' in source) {
					this.refuseCall(source.refusal);
					return;
				}
				if (!eventId) {
					this.refuseCall('--event-id is required when using --backup or --esdb-url');
					return;
				}

				const eventFromSource = await readEvent(source, eventId);
				if (!eventFromSource) {
					this.log(`✗ Event with ID ${eventId} not found`);
					process.exitCode = 1;
					return;
				}

				event = eventFromSource;
			}

			// A hash of a version the tool does not know is no mismatch, so it is
			// reported apart from one, with the hash that names the version.
			let hashCheck: ReturnType<ChainEvent['checkHash']>;
			try {
				hashCheck = event.checkHash();
			} catch (error) {
				if (!(error instanceof UnsupportedHashVersionError)) {
					throw error;
				}

				this.log(`✗ ${error.message}`);
				this.log(`Event ID: ${event.id}`);
				this.log(`Stored hash: ${event.hash}`);
				process.exitCode = 1;
				return;
			}

			if (!hashCheck.isMatching) {
				for (const line of describeHashMismatch(event, hashCheck.calculatedHash)) {
					this.log(line);
				}
				process.exitCode = 1;
				return;
			}

			this.log(`✓ Hash is valid`);
			this.log(`Event ID: ${event.id}`);
			this.log(`Hash: ${event.hash}`);
		} catch (error) {
			this.log(`✗ Failed to validate event hash: ${describeError(error)}`);
			process.exitCode = 1;
		}
	}
}
