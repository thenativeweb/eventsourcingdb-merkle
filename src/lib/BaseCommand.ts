import { Command } from '@oclif/core';

export default abstract class BaseCommand extends Command {
	// refuseCall reports a call whose arguments or flags do not fit together, as
	// oclif does for those it refuses itself, with the exit code 2.
	protected refuseCall(message: string): void {
		this.log(`✗ ${message}`);
		this.log('See more help with --help');
		process.exitCode = 2;
	}

	protected override catch(error: Error & { oclif?: { exit?: number } }): Promise<unknown> {
		// oclif ends with the exit code 2 where it refuses the arguments and flags
		// of a call, such as an argument that is missing or unexpected, a flag that
		// does not exist, or two flags that cannot be used together. Such a call
		// gets a message of its own rather than a stack trace.
		if (error.oclif?.exit === 2) {
			// Remove the "See more help with --help" line from oclif
			const lines = error.message.split('\n');
			const filteredLines = lines.filter(line => !line.includes('See more help'));
			const message = filteredLines.join('\n').trim();

			this.refuseCall(message);
			return Promise.resolve();
		}

		// For other errors, use default oclif error handling
		return super.catch(error);
	}
}
