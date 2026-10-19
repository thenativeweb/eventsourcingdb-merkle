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

### Choosing the Source

Every command that reads events reads them either from a backup file, which you name with `--backup`, or from a running EventSourcingDB, which you name with `--esdb-url` and its API token with `--esdb-api-token`:

```shell
eventsourcingdb-merkle validate-chain --backup=backup.json
eventsourcingdb-merkle validate-chain --esdb-url=http://localhost:3000 --esdb-api-token="$ESDB_API_TOKEN"
```

A backup freezes the events it holds, and it can be handed on to someone who should verify it. A running database needs no backup first. Note that EventSourcingDB has no API token that only reads, so whoever reads a running database holds a token that could write as well. Passing the token from a variable, as above, keeps it out of the history of your shell.

The tool reads a running database through the client SDK of EventSourcingDB, which uses the v2 API where the server offers it, from release 1.3 on. There, a read that is cut short fails rather than passing as complete. A server before release 1.3 offers only the v1 API, where the two cannot be told apart. The SDK verifies the hash of each event itself, so where one does not match, the tool names the stored hash, but not the one the SDK calculated.

### Validating Event Chains

To ensure that a backup file has not been tampered with or corrupted, call the `validate-chain` command and name the backup file or the database, as described above. The command verifies that each event's hash is correctly calculated, that the predecessor hash of each event matches the hash of the previous event, and that the first event has a null predecessor hash as expected:

```shell
eventsourcingdb-merkle validate-chain --backup=backup.json
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

To calculate the Merkle root for all events in a backup file, call the `merkle-root` command and name the backup file or the database. The Merkle root is a single hash that represents the entire event chain and can be used to verify the integrity of the backup:

```shell
eventsourcingdb-merkle merkle-root --backup=backup.json
```

The command outputs the Merkle root, the total number of events, and the ID of the last event it covers:

```
Merkle Root: esdb:merkle:v2:d1f6713af7ba3896ff238bb51f3986b2bad53b09bda7f23370e0a8b6eb97eeab
Total events: 4
Last event ID: 3
```

#### Calculating the Merkle Root of an Earlier State

A root that you published once has to be calculated again later, for instance to generate proofs against it. Since events are never changed, a newer backup, or the database itself, holds the events of an older backup, followed by those written since. Pass the last event ID that the root covered with `--last-event-id`, and the command calculates the root over the events up to it, which is the root of the older backup:

```shell
eventsourcingdb-merkle merkle-root --backup=backup-2025.json --last-event-id=3
```

So you do not have to keep the older backup to prove against its root. If the backup or the database holds no event with that ID, the command refuses rather than calculating a root over other events.

#### Salting the Leaves

A proof names the hashes next to the path from its event to the root, and the first of them belongs to a neighboring event. That hash does not reveal the event, but whoever holds the proof and has a guess about the neighbor, such as its type, its subject, its time, and its data, can calculate its hash and so check the guess. Where your events can be guessed like that, salt the leaves of the tree: a random value in front of every leaf, which only a proof of that leaf discloses, makes the other hashes in a proof tell nothing.

The tool derives the salt of every leaf from a key, so that no salt has to be kept. Generate the key once, and pass it with `--salt-key-file` whenever you calculate the root, or a proof against it:

```shell
eventsourcingdb-merkle generate-salt-key --output=merkle.key
eventsourcingdb-merkle merkle-root --backup=backup.json --salt-key-file=merkle.key
```

The key file holds 64 hexadecimal digits. `generate-salt-key` never overwrites a file, and it lets nobody write the key, and on Linux and macOS, only the owner of the file read it. Windows knows only whether a file is read-only, so there, who can read the key follows from the permissions of its folder. Keep the key as long as the root, and as safely as a password: a root calculated with it is calculated again with that key only, so without it, no further proof can be generated for the root, and whoever has it can calculate the salt of every leaf. A proof carries the salt of its own leaf, so verifying it needs no key.

#### Calculating a Root of Version 1

Releases before 3.0 built the tree in another way, which is version 1 of the tree: it hashes leaves and inner nodes alike, and pairs the last node of a level with itself where it has no partner, so that a list of hashes has the same root as the same list with its last hash twice. A root of version 2 starts with `esdb:merkle:v2:`, a root of version 1 has no prefix. To calculate a root of version 1 again, or to prove an event against one, pass `--tree-version=1`. Version 1 knows no salts:

```shell
eventsourcingdb-merkle merkle-root --backup=backup.json --tree-version=1
```

### Validating Individual Events

Sometimes you want to verify the integrity of a single event without processing the entire backup. The `validate-event-hash` command provides two ways to do this.

#### Validating an Event from a Backup File or a Database

To validate an event by its ID from a backup file or a database, call the `validate-event-hash` command with `--event-id` and the source:

```shell
eventsourcingdb-merkle validate-event-hash --backup=backup.json --event-id=42
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

Read from a database, the client SDK verifies the hash and keeps the hash it calculated to itself, so the command shows the stored hash only:

```
✗ Hash mismatch
Event ID: 42
Stored hash: abc123...
```

#### Validating an Event from JSON

You can also validate an event provided as a JSON string. This is useful when you receive an event from an external source and want to verify its hash without having access to the backup file. The command takes a line of a backup, a line of `read-events`, or an event on its own, with its hash:

```shell
eventsourcingdb-merkle validate-event-hash --event='{"specversion":"1.0","id":"0",...,"hash":"esdb:hash:v2:..."}'
```

If you provide a CloudEvent without a stored hash, the command simply calculates and displays the hash in every version, since nothing tells which version is meant:

```
Calculated hash (version 1): abc123...
Calculated hash (version 2): esdb:hash:v2:def456...
```

### Generating Merkle Proofs

A Merkle proof allows you to prove that a specific event is part of a backup without revealing the entire backup. To generate a proof for an event, call the `get-proof` command with the source and the event ID in `--event-id`:

```shell
eventsourcingdb-merkle get-proof --backup=backup.json --event-id=42
```

The command outputs the proof in a human-readable format:

```
Merkle Proof for Event 42

Event Hash: esdb:hash:v2:abc123...
Merkle Root: esdb:merkle:v2:d1f6713af7ba3896ff238bb51f3986b2bad53b09bda7f23370e0a8b6eb97eeab

Sibling Hashes (3):
  1. def456... (left)
  2. ghi789... (right)
  3. jkl012... (left)
```

To prove an event against the root of an earlier state, pass its last event ID with `--last-event-id`, as for `merkle-root`. An event after it is not part of that tree, so the command refuses to prove it:

```shell
eventsourcingdb-merkle get-proof --backup=backup.json --event-id=42 --last-event-id=1234566
```

To prove an event against a root whose leaves are salted, pass the same key with `--salt-key-file`, and to prove it against a root of version 1, pass `--tree-version=1`, as for `merkle-root`. A proof against a salted root carries the salt of the leaf of its event, right after the hash of the event:

```shell
eventsourcingdb-merkle get-proof --backup=backup.json --event-id=42 --salt-key-file=merkle.key
```

```
Merkle Proof for Event 42

Event Hash: esdb:hash:v2:abc123...
Salt: 9c1f0b...
Merkle Root: esdb:merkle:v2:5f0c3e...
```

#### Outputting JSON

To get the proof as JSON for programmatic use, add the `--json` flag:

```shell
eventsourcingdb-merkle get-proof --backup=backup.json --event-id=42 --json
```

The output can then be saved to a file and shared with others:

```json
{
  "eventId": "42",
  "eventHash": "esdb:hash:v2:abc123...",
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
  "merkleRoot": "esdb:merkle:v2:d1f6713af7ba3896ff238bb51f3986b2bad53b09bda7f23370e0a8b6eb97eeab"
}
```

A proof against a salted root holds its salt in `salt`, right after `eventHash`.

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

The command verifies proofs of either version of the tree, which it tells apart by their root, and takes the salt of a salted proof from the proof itself, so it needs neither the backup nor the key.

If the proof is valid, the command confirms this and displays the event details:

```
✓ Merkle proof is valid
Event ID: 42
Event Hash: esdb:hash:v2:abc123...
Merkle Root: esdb:merkle:v2:d1f6713af7ba3896ff238bb51f3986b2bad53b09bda7f23370e0a8b6eb97eeab
```

If the proof is invalid, the command indicates this with a non-zero exit code:

```
✗ Merkle proof is invalid
Event ID: 42
Event Hash: esdb:hash:v2:abc123...
Merkle Root: esdb:merkle:v2:d1f6713af7ba3896ff238bb51f3986b2bad53b09bda7f23370e0a8b6eb97eeab
```

## Understanding the Technical Details

The tool implements Merkle trees using SHA-256 hashing, following the EventSourcingDB specification for event hash calculation, which knows two versions. An event keeps the version of the hash it was written with, so the tool verifies every hash in the version it names:

- A hash of version 2, which EventSourcingDB writes from release 1.3 on, starts with `esdb:hash:v2:`. It is the SHA-256 of that prefix and of the fields `specversion`, `id`, `predecessorhash`, `time`, `source`, `subject`, `type`, `datacontenttype`, `traceparent`, `tracestate`, and `data`, each on a line of its own, with `-` for a field that the event does not have.
- A hash without a prefix is of version 1. It is computed by first creating a metadata string from the CloudEvents fields, then hashing the metadata and the data separately, and finally hashing the concatenation of both hashes. It covers neither `traceparent` nor `tracestate`.

In both versions, the data is hashed as it appears in the backup or in the event given with `--event`, rather than parsed and serialized again, since that would change escape sequences such as `\u003c` for `<` and the notation of numbers. Only the whitespace between its tokens is left out, which EventSourcingDB never writes, so that an event formatted afterwards, as by a viewer or by `jq` without `-c`, still verifies.

The Merkle tree of version 2 follows [RFC 6962](https://www.rfc-editor.org/rfc/rfc6962), as the tree of [eventsourcingdb-auditing](https://github.com/thenativeweb/eventsourcingdb-auditing) does:

- The data of a leaf is the hash of its event as it is stored, prefix included, as text in UTF-8. Where the leaves are salted, its salt comes first: the HMAC-SHA256 of that text under the salt key.
- The hash of a leaf is the SHA-256 of the byte `0x00` followed by its data, and the hash of an inner node is the SHA-256 of the byte `0x01` followed by the hashes of its two children, so that neither can pass for the other.
- The tree splits its leaves at the largest power of two smaller than their number, and never duplicates a node. Its root is the hash of its top node in hexadecimal, after the prefix `esdb:merkle:v2:`.

The tree of version 1 takes the stored hashes as its leaves, and hashes the concatenation of the hashes of its two children, as text, for an inner node. Where a level has an odd number of nodes, it pairs the last one with itself.

Backup files are expected to be in one of the two NDJSON formats that EventSourcingDB writes, and the tool reads every backup that a restore of EventSourcingDB takes. It checks the structure of a backup, the hashes, and the chain, but neither the values of the events nor the schemas, which a restore checks with the rules of the server:

- A backup of the v1 API, which EventSourcingDB writes on `/api/v1/backup`, holds a JSON object with a `type` and a `payload` field on each line. A line of the type `event` holds a CloudEvents-compliant event and its hash. A line of the type `schema` holds the schema of an event type, which the tool skips, since neither the hashes nor the chain cover it.
- A backup of the v2 API, which EventSourcingDB writes on `/api/v2/management/create-backup` from release 1.3 on, holds a JSON object with a `type` and a `data` field on each line. It begins with a line of the type `backup`, which names the version of its format, and ends with a line of the type `end`. An incremental backup follows on the last event of the backup before it. To verify one, append it to the full backup and the increments before it, in their order, as a restore takes them, for example with `cat full.ndjson increment-1.ndjson increment-2.ndjson`: across them, the chain is the ordinary chain of the events.

A backup that holds a line of the type `error` was cut short, and the tool refuses it, as it refuses a line of any type that its format does not know, a line that is not valid JSON, and a backup of the v2 API whose structure a restore would refuse, naming the line.

## Running Quality Assurance

To verify that the tool is working correctly during development, run the quality assurance checks:

```shell
npm run qa
```
