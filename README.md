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

You can also validate an event provided as a JSON string. This is useful when you receive an event from an external source and want to verify its hash without having access to the backup file:

```shell
eventsourcingdb-merkle validate-event-hash --event='{"specversion":"1.0","id":"0",...}'
```

If you provide a CloudEvent without a stored hash, the command simply calculates and displays the hash:

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

The tool implements Merkle trees using SHA-256 hashing, following the EventSourcingDB specification for event hash calculation. Event hashes are computed by first creating a metadata string from the CloudEvents fields, then hashing the metadata and the JSON-stringified data separately, and finally hashing the concatenation of both hashes.

The Merkle tree is constructed by treating event hashes as leaf nodes. Internal nodes are created by hashing the concatenation of their child hashes. If the number of nodes at any level is odd, the last node is duplicated to create a complete binary tree. This process continues until a single root hash remains.

Backup files are expected to be in NDJSON format, where each line contains a JSON object with a `type` field set to `"event"` and a `payload` field containing both the CloudEvents-compliant event and its hash. This format ensures that the tool can efficiently process large backup files without loading the entire file into memory.

## Running Quality Assurance

To verify that the tool is working correctly during development, run the quality assurance checks:

```shell
npm run qa
```
