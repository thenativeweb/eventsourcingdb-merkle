import { Flags } from '@oclif/core';
import BaseCommand from '../lib/BaseCommand.js';
import { findEventById, readBackupFile } from '../lib/backupReader.js';
import { calculateEventHash } from '../lib/hash.js';
import type { BackupEntry, CloudEvent } from '../lib/types.js';

export default class ValidateEventHash extends BaseCommand {
	static override description =
		'Validate the hash of a specific event (with or without backup file)';

	static override examples = [
		'<%= config.bin %> <%= command.id %> --file=backup.json --event-id=42',
		// biome-ignore lint/security/noSecrets: This is an example command, not a secret
		'<%= config.bin %> <%= command.id %> --event=\'{"specversion":"1.0",...}\'',
	];

	static override flags = {
		file: Flags.string({ description: 'Path to the backup file', exclusive: ['event'] }),
		'event-id': Flags.string({
			description: 'Event ID to validate (requires --file)',
			exclusive: ['event'],
		}),
		event: Flags.string({
			description: 'JSON string of the event to validate',
			exclusive: ['file', 'event-id'],
		}),
	};

	static override args = {};

	public async run(): Promise<void> {
		const { flags } = await this.parse(ValidateEventHash);

		if (!flags.file && !flags.event) {
			this.log('✗ Either --file and --event-id, or --event must be provided');
			this.log('See more help with --help');
			process.exitCode = 2;
			return;
		}

		if (flags.file && !flags['event-id']) {
			this.log('✗ --event-id is required when using --file');
			this.log('See more help with --help');
			process.exitCode = 2;
			return;
		}

		const filePath = flags.file;
		const eventId = flags['event-id'];

		try {
			let entry: BackupEntry | undefined;
			let event: CloudEvent;
			let storedHash: string;
			let originalDataString: string | undefined;

			if (flags.event) {
				// Parse event from JSON string
				const parsed = JSON.parse(flags.event) as BackupEntry | CloudEvent;

				// Check if it's a BackupEntry or a CloudEvent
				if ('type' in parsed && parsed.type === 'event' && 'payload' in parsed) {
					entry = parsed as BackupEntry;
					event = entry.payload.event;
					storedHash = entry.payload.hash;
					originalDataString = entry.payload.originalDataString;
				} else {
					event = parsed as CloudEvent;
					// No stored hash to compare against
					const calculatedHash = calculateEventHash(event);
					this.log(`Calculated hash: ${calculatedHash}`);
					return;
				}
			} else {
				// Read from file
				if (!filePath || !eventId) {
					this.log('✗ File path and event ID are required');
					process.exitCode = 2;
					return;
				}

				const entries = await readBackupFile(filePath);
				entry = findEventById(entries, eventId);

				if (!entry) {
					this.log(`✗ Event with ID ${eventId} not found`);
					process.exitCode = 1;
					return;
				}

				event = entry.payload.event;
				storedHash = entry.payload.hash;
				originalDataString = entry.payload.originalDataString;
			}

			const calculatedHash = calculateEventHash(event, originalDataString);

			if (calculatedHash !== storedHash) {
				this.log(`✗ Hash mismatch`);
				this.log(`Event ID: ${event.id}`);
				this.log(`Stored hash:     ${storedHash}`);
				this.log(`Calculated hash: ${calculatedHash}`);
				process.exitCode = 1;
				return;
			}

			this.log(`✓ Hash is valid`);
			this.log(`Event ID: ${event.id}`);
			this.log(`Hash: ${storedHash}`);
		} catch (error) {
			this.log(
				`✗ Failed to validate event hash: ${error instanceof Error ? error.message : String(error)}`,
			);
			process.exitCode = 1;
		}
	}
}
