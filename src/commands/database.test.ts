import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Container } from 'eventsourcingdb';

const fourEventsUpToEvent3 = /\nTotal events: 4\nLast event ID: 3\n$/u;

const run = (args: string[]): { output: string; exitCode: number } => {
	try {
		return {
			output: execFileSync('node', ['./dist/index.js', ...args], {
				encoding: 'utf-8',
				stdio: 'pipe',
			}),
			exitCode: 0,
		};
	} catch (error: unknown) {
		const { stdout, status } = error as { stdout: string; status: number };
		return { output: stdout, exitCode: status };
	}
};

// A database that holds events of both versions of the hash, as one does after
// an update to EventSourcingDB 1.3: the events that release 1.2.0 wrote, restored
// from its backup, followed by events that the preview of 1.3 wrote.
describe('reading a running database', () => {
	// Only the preview of EventSourcingDB 1.3 writes hashes of version 2 and
	// offers the v2 API yet.
	const container = new Container().withImageTag('preview');
	let source: string[] = [];

	before(async () => {
		await container.start();
		const url = container.getBaseUrl().toString();
		const apiToken = container.getApiToken();
		source = [`--esdb-url=${url}`, `--esdb-api-token=${apiToken}`];

		const restore = await fetch(new URL('/api/v1/restore', url), {
			method: 'POST',
			headers: { authorization: `Bearer ${apiToken}` },
			body: readFileSync('test-fixtures/backup-before-version-2.ndjson', 'utf-8'),
		});
		if (restore.status !== 200) {
			throw new Error(`Test fixture setup failed: ${await restore.text()}`);
		}

		await container.getClient().writeEvents([
			{
				source: 'https://library.eventsourcingdb.io',
				subject: '/books/42',
				type: 'io.eventsourcingdb.library.book-returned',
				data: { condition: 'good' },
			},
			{
				source: 'https://library.eventsourcingdb.io',
				subject: '/books/43',
				type: 'io.eventsourcingdb.library.book-acquired',
				traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
				tracestate: 'rojo=00f067aa0ba902b7',
				data: { note: 'a } b { c', title: 'Tom & <Jerry>' },
			},
		]);
	});

	after(async () => {
		await container.stop();
	});

	const backUp = async (): Promise<string> => {
		const response = await fetch(new URL('/api/v1/backup', container.getBaseUrl()), {
			method: 'POST',
			headers: { authorization: `Bearer ${container.getApiToken()}` },
		});
		const filePath = join(mkdtempSync(join(tmpdir(), 'esdb-merkle-')), 'backup.ndjson');
		writeFileSync(filePath, await response.text());

		return `--backup=${filePath}`;
	};

	it('validates the chain of the database', () => {
		const { output, exitCode } = run(['validate-chain', ...source]);

		assert.strictEqual(exitCode, 0, output);
		assert.strictEqual(output, '✓ Chain is valid (4 events)\n');
	});

	it('calculates the same Merkle root as from a backup of the database', async () => {
		const backup = await backUp();

		const fromDatabase = run(['merkle-root', ...source]);
		const fromBackup = run(['merkle-root', backup]);

		assert.strictEqual(fromDatabase.exitCode, 0, fromDatabase.output);
		assert.strictEqual(fromDatabase.output, fromBackup.output);
		assert.match(fromDatabase.output, fourEventsUpToEvent3);
	});

	it('calculates the root of an earlier state again from the database', () => {
		const older = run(['merkle-root', '--backup=test-fixtures/backup-before-version-2.ndjson']);
		const fromDatabase = run(['merkle-root', ...source, '--last-event-id=1']);

		assert.strictEqual(fromDatabase.exitCode, 0, fromDatabase.output);
		assert.strictEqual(fromDatabase.output, older.output);
	});

	it('refuses a last event ID that the database does not hold', () => {
		const { output, exitCode } = run(['merkle-root', ...source, '--last-event-id=9']);

		assert.strictEqual(exitCode, 1);
		assert.strictEqual(
			output,
			'✗ Failed to calculate Merkle root: the database holds no event with ID 9\n',
		);
	});

	it('generates a proof that verifies against the root of the database', () => {
		const root = run(['merkle-root', ...source]).output.split('\n')[0];
		const { output, exitCode } = run(['get-proof', ...source, '--event-id=3', '--json']);
		assert.strictEqual(exitCode, 0, output);

		assert.strictEqual(
			`Merkle Root: ${(JSON.parse(output) as { merkleRoot: string }).merkleRoot}`,
			root,
		);
		assert.strictEqual(run(['verify-proof', output]).exitCode, 0);
	});

	it('validates the hash of an event of either version in the database', () => {
		for (const eventId of ['1', '3']) {
			const { output, exitCode } = run(['validate-event-hash', ...source, `--event-id=${eventId}`]);

			assert.strictEqual(exitCode, 0, output);
			assert.ok(output.startsWith(`✓ Hash is valid\nEvent ID: ${eventId}\n`), output);
		}
	});

	it('reports an event that the database does not hold', () => {
		const { output, exitCode } = run(['validate-event-hash', ...source, '--event-id=9']);

		assert.strictEqual(exitCode, 1);
		assert.strictEqual(output, '✗ Event with ID 9 not found\n');
	});

	it('takes an event ID in another notation of the same number, as for a backup', () => {
		const { output, exitCode } = run(['validate-event-hash', ...source, '--event-id=03']);

		assert.strictEqual(exitCode, 0, output);
		assert.ok(output.startsWith('✓ Hash is valid\nEvent ID: 3\n'), output);
	});

	it('reports an event ID that names no number as not found, as for a backup', () => {
		const { output, exitCode } = run(['validate-event-hash', ...source, '--event-id=abc']);

		assert.strictEqual(exitCode, 1);
		assert.strictEqual(output, '✗ Event with ID abc not found\n');
	});

	it('reports an API token that the database rejects, without naming it', () => {
		const [url] = source;
		const token = 'not-the-token-of-this-database';
		const { output, exitCode } = run(['validate-chain', url ?? '', `--esdb-api-token=${token}`]);

		assert.strictEqual(exitCode, 1);
		assert.ok(output.startsWith('✗ Failed to validate chain: '), output);
		assert.ok(!output.includes(token), output);
	});
});

// EventSourcingDB 1.2.0 offers the v1 API only, which the SDK falls back to.
describe('reading a running database before version 2 of the API', () => {
	const container = new Container().withImageTag('1.2.0');

	before(async () => {
		await container.start();
		await container.getClient().writeEvents([
			{
				source: 'https://library.eventsourcingdb.io',
				subject: '/books/42',
				type: 'io.eventsourcingdb.library.book-acquired',
				data: { title: 'Tom & <Jerry>' },
			},
		]);
	});

	after(async () => {
		await container.stop();
	});

	it('validates the chain of the database', () => {
		const { output, exitCode } = run([
			'validate-chain',
			`--esdb-url=${container.getBaseUrl().toString()}`,
			`--esdb-api-token=${container.getApiToken()}`,
		]);

		assert.strictEqual(exitCode, 0, output);
		assert.strictEqual(output, '✓ Chain is valid (1 events)\n');
	});

	it('takes an event ID in another notation of the same number', () => {
		const { output, exitCode } = run([
			'validate-event-hash',
			`--esdb-url=${container.getBaseUrl().toString()}`,
			`--esdb-api-token=${container.getApiToken()}`,
			'--event-id=00',
		]);

		assert.strictEqual(exitCode, 0, output);
		assert.ok(output.startsWith('✓ Hash is valid\nEvent ID: 0\n'), output);
	});
});

describe('reading a database that does not answer', () => {
	it('names the reason why it could not be reached', () => {
		const { output, exitCode } = run([
			'validate-chain',
			// Nothing listens on this port, so the connection is refused.
			'--esdb-url=http://127.0.0.1:47391',
			'--esdb-api-token=secret',
		]);

		assert.strictEqual(exitCode, 1);
		assert.ok(output.startsWith('✗ Failed to validate chain: fetch failed: '), output);
		assert.ok(output.includes('ECONNREFUSED'), output);
	});
});

describe('naming the source', () => {
	const backup = '--backup=test-fixtures/backup-with-both-hash-versions.ndjson';
	const url = '--esdb-url=http://localhost:1';
	const token = '--esdb-api-token=secret';

	const cases: { name: string; args: string[]; message: string }[] = [
		{
			name: 'no source',
			args: ['validate-chain'],
			message: 'Either --backup or --esdb-url must be provided',
		},
		{
			name: 'no source for merkle-root',
			args: ['merkle-root'],
			message: 'Either --backup or --esdb-url must be provided',
		},
		{
			name: 'no source for get-proof',
			args: ['get-proof'],
			message: 'Either --backup or --esdb-url must be provided',
		},
		{
			name: 'a backup and a database',
			args: ['validate-chain', backup, url, token],
			message: '--backup and --esdb-url cannot be used together',
		},
		{
			name: 'a backup and a token',
			args: ['merkle-root', backup, token],
			message: '--backup and --esdb-api-token cannot be used together',
		},
		{
			name: 'a database without a token',
			args: ['get-proof', url, '--event-id=0'],
			message: '--esdb-api-token is required when using --esdb-url',
		},
		{
			name: 'a database without an event ID',
			args: ['get-proof', url, token],
			message: '--event-id is required when using --backup or --esdb-url',
		},
		{
			name: 'no source for validate-event-hash',
			args: ['validate-event-hash'],
			message: 'Either --backup or --esdb-url with --event-id, or --event must be provided',
		},
		{
			name: 'a database without an event ID for validate-event-hash',
			args: ['validate-event-hash', url, token],
			message: '--event-id is required when using --backup or --esdb-url',
		},
		{
			name: 'an event and a token',
			args: ['validate-event-hash', '--event={}', token],
			message: '--event and --esdb-api-token cannot be used together',
		},
	];

	for (const { name, args, message } of cases) {
		it(`refuses ${name}`, () => {
			const { output, exitCode } = run(args);

			assert.strictEqual(exitCode, 2);
			assert.strictEqual(output, `✗ ${message}\nSee more help with --help\n`);
			assert.ok(!output.includes('secret'));
		});
	}
});
