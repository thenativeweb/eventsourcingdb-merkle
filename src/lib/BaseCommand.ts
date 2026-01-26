import { Command } from '@oclif/core';

export default abstract class BaseCommand extends Command {
	protected catch(error: Error & { oclif?: { exit?: number } }): Promise<unknown> {
		const errorName = error.constructor.name;

		// Check if it's a RequiredArgsError or NonExistentFlagsError
		if (errorName === 'RequiredArgsError' || errorName === 'NonExistentFlagsError') {
			// Remove the "See more help with --help" line from oclif
			const lines = error.message.split('\n');
			const filteredLines = lines.filter(line => !line.includes('See more help'));
			const message = filteredLines.join('\n').trim();

			this.log(`✗ ${message}`);
			this.log('See more help with --help');
			process.exitCode = 2;
			return Promise.resolve();
		}

		// For other errors, use default oclif error handling
		return super.catch(error);
	}
}
