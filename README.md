# eventsourcingdb-merkle

Merkle tree utilities for [EventSourcingDB](https://www.eventsourcingdb.io) backups.

This CLI tool provides utilities to validate, verify, and generate Merkle proofs for EventSourcingDB backup files. It enables you to ensure the integrity of event chains and create cryptographic proofs for individual events without requiring access to the entire backup.

For more information on EventSourcingDB, see its [official documentation](https://docs.eventsourcingdb.io/).

## Getting Started

Install the CLI tool globally:

```shell
npm install -g eventsourcingdb-merkle
```

Or use it directly with `npx` without installing:

```shell
npx eventsourcingdb-merkle [COMMAND]
```

### Validating Event Chains

To ensure that a backup file has not been tampered with or corrupted, call the `validate-chain` command and provide the path to your backup file. The command verifies that each event's hash is correctly calculated, that the predecessor hash of each event matches the hash of the previous event, and that the first event has a null predecessor hash as expected:

```shell
eventsourcingdb-merkle validate-chain backup.json
```

If the chain is valid, you will see a confirmation message with the total number of events:

```
✓ Chain is valid (8220 events)
```

If the chain is invalid, the command lists all errors found:

```
✗ Chain validation failed
Total events: 8220
Errors found: 2

Event 42: Hash mismatch: expected abc..., got def...
Event 43: Predecessor hash mismatch: expected def..., got ghi...
```

An event whose hash names a version of the hash that the tool does not know is listed as such, rather than as a mismatch:

```
Event 44: Unsupported hash version: v3
```

Such an event cannot be verified, which is not the same as being tampered with, and a newer version of the tool may know its version.

*Note that the command will exit with a non-zero exit code if the chain is invalid, which makes it suitable for use in CI/CD pipelines.*

### Calculating the Merkle Root

To calculate the Merkle root for all events in a backup file, call the `merkle-root` command and provide the path to your backup file. The Merkle root is a single hash that represents the entire event chain and can be used to verify the integrity of the backup:

```shell
eventsourcingdb-merkle merkle-root backup.json
```

The command outputs the Merkle root and the total number of events:

```
Merkle Root: d1f6713af7ba3896ff238bb51f3986b2bad53b09bda7f23370e0a8b6eb97eeab
Total events: 4
```

### Validating Individual Events

Sometimes you want to verify the integrity of a single event without processing the entire backup. The `validate-event-hash` command provides two ways to do this.

#### Validating an Event from a Backup File

To validate an event by its ID from a backup file, call the `validate-event-hash` command with the `--file` and `--event-id` flags:

```shell
eventsourcingdb-merkle validate-event-hash --file=backup.json --event-id=42
```

If the hash is valid, you will see a confirmation message:

```
✓ Hash is valid
Event ID: 42
Hash: abc123...
```

If the hash does not match, the command shows both the stored and calculated hashes:

```
✗ Hash mismatch
Event ID: 42
Stored hash:     abc123...
Calculated hash: def456...
```

#### Validating an Event from JSON

You can also validate an event provided as a JSON string. This is useful when you receive an event from an external source and want to verify its hash without having access to the backup file. The command takes a line of a backup, a line of `read-events`, or an event on its own, with its hash:

```shell
eventsourcingdb-merkle validate-event-hash --event='{"specversion":"1.0","id":"0",...,"hash":"esdb:hash:v2:..."}'
```

If you provide a CloudEvent without a stored hash, the command simply calculates and displays the hash of version 1, since nothing tells which version is meant:

```
Calculated hash: abc123...
```

### Generating Merkle Proofs

A Merkle proof allows you to prove that a specific event is part of a backup without revealing the entire backup. To generate a proof for an event, call the `get-proof` command with the path to your backup file and the event ID:

```shell
eventsourcingdb-merkle get-proof backup.json 42
```

The command outputs the proof in a human-readable format:

```
Merkle Proof for Event 42

Event Hash: abc123...
Merkle Root: d1f6713af7ba3896ff238bb51f3986b2bad53b09bda7f23370e0a8b6eb97eeab

Sibling Hashes (3):
  1. def456... (left)
  2. ghi789... (right)
  3. jkl012... (left)
```

#### Outputting JSON

To get the proof as JSON for programmatic use, add the `--json` flag:

```shell
eventsourcingdb-merkle get-proof backup.json 42 --json
```

The output can then be saved to a file and shared with others:

```json
{
  "eventId": "42",
  "eventHash": "abc123...",
  "siblingHashes": [
    {
      "hash": "def456...",
      "position": "left"
    },
    {
      "hash": "ghi789...",
      "position": "right"
    },
    {
      "hash": "jkl012...",
      "position": "left"
    }
  ],
  "merkleRoot": "d1f6713af7ba3896ff238bb51f3986b2bad53b09bda7f23370e0a8b6eb97eeab"
}
```

### Verifying Merkle Proofs

Once you have a Merkle proof, you can verify it without needing the original backup file. This is particularly useful when you receive a proof from someone else and want to verify that the event is indeed part of the backup with the claimed Merkle root.

To verify a proof, call the `verify-proof` command and provide either a path to a JSON file containing the proof, or the proof as a JSON string:

```shell
eventsourcingdb-merkle verify-proof proof.json
```

Or with a JSON string:

```shell
eventsourcingdb-merkle verify-proof '{"eventId":"42","eventHash":"...","siblingHashes":[],"merkleRoot":"..."}'
```

If the proof is valid, the command confirms this and displays the event details:

```
✓ Merkle proof is valid
Event ID: 42
Event Hash: abc123...
Merkle Root: d1f6713af7ba3896ff238bb51f3986b2bad53b09bda7f23370e0a8b6eb97eeab
```

If the proof is invalid, the command indicates this with a non-zero exit code:

```
✗ Merkle proof is invalid
Event ID: 42
Event Hash: abc123...
Merkle Root: d1f6713af7ba3896ff238bb51f3986b2bad53b09bda7f23370e0a8b6eb97eeab
```

## Understanding the Technical Details

The tool implements Merkle trees using SHA-256 hashing, following the EventSourcingDB specification for event hash calculation, which knows two versions. An event keeps the version of the hash it was written with, so the tool verifies every hash in the version it names:

- A hash of version 2, which EventSourcingDB writes from release 1.3 on, starts with `esdb:hash:v2:`. It is the SHA-256 of that prefix and of the fields `specversion`, `id`, `predecessorhash`, `time`, `source`, `subject`, `type`, `datacontenttype`, `traceparent`, `tracestate`, and `data`, each on a line of its own, with `-` for a field that the event does not have.
- A hash without a prefix is of version 1. It is computed by first creating a metadata string from the CloudEvents fields, then hashing the metadata and the data separately, and finally hashing the concatenation of both hashes. It covers neither `traceparent` nor `tracestate`.

In both versions, the data is hashed as it appears in the backup or in the event given with `--event`, rather than parsed and serialized again, since that would change escape sequences such as `\u003c` for `<` and the notation of numbers. Only the whitespace between its tokens is left out, which EventSourcingDB never writes, so that an event formatted afterwards, as by a viewer or by `jq` without `-c`, still verifies.

The Merkle tree is constructed by treating event hashes, as they are stored, prefix included, as leaf nodes. Internal nodes are created by hashing the concatenation of their child hashes. If the number of nodes at any level is odd, the last node is duplicated to create a complete binary tree. This process continues until a single root hash remains.

Backup files are expected to be in one of the two NDJSON formats that EventSourcingDB writes, and the tool reads what a restore of EventSourcingDB takes. It checks the structure of a backup, the hashes, and the chain, but neither the values of the events nor the schemas, which a restore checks with the rules of the server:

- A backup of the v1 API, which EventSourcingDB writes on `/api/v1/backup`, holds a JSON object with a `type` and a `payload` field on each line. A line of the type `event` holds a CloudEvents-compliant event and its hash. A line of the type `schema` holds the schema of an event type, which the tool skips, since neither the hashes nor the chain cover it.
- A backup of the v2 API, which EventSourcingDB writes on `/api/v2/management/create-backup` from release 1.3 on, holds a JSON object with a `type` and a `data` field on each line. It begins with a line of the type `backup`, which names the version of its format, and ends with a line of the type `end`. An incremental backup follows on the last event of the backup before it. To verify one, append it to the full backup and the increments before it, in their order, as a restore takes them, for example with `cat full.ndjson increment-1.ndjson increment-2.ndjson`: across them, the chain is the ordinary chain of the events.

A backup that holds a line of the type `error` was cut short, and the tool refuses it, as it refuses a line of any type that its format does not know, a line that is not valid JSON, and a backup of the v2 API whose structure a restore would refuse, naming the line.

## Running Quality Assurance

To verify that the tool is working correctly during development, run the quality assurance checks:

```shell
npm run qa
```
