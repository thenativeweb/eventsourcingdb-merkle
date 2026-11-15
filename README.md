# eventsourcingdb-merkle

Merkle tree utilities for [EventSourcingDB](https://www.eventfoundation.io/products/eventsourcingdb): a command line tool that validates the chain of hashes of your events, calculates a Merkle root as their fingerprint, and generates and verifies Merkle proofs, which prove a single event to others without handing over any other event.

The complete documentation of this tool, including reading from a running database, roots of earlier states, salted leaves, earlier versions of the tree, and the technical details, is available at **[https://www.eventfoundation.io/docs/eventsourcingdb/merkle-cli](https://www.eventfoundation.io/docs/eventsourcingdb/merkle-cli)**.

## Getting Started

Install the CLI tool globally:

```shell
npm install -g eventsourcingdb-merkle
```

Or use it directly with `npx` without installing:

```shell
npx eventsourcingdb-merkle [COMMAND]
```

Validate the chain of hashes in a backup:

```shell
eventsourcingdb-merkle validate-chain --backup=backup.json
```

Calculate its Merkle root:

```shell
eventsourcingdb-merkle merkle-root --backup=backup.json
```

Generate a proof for an event, and verify it:

```shell
eventsourcingdb-merkle get-proof --backup=backup.json --event-id=42 --json > proof.json
eventsourcingdb-merkle verify-proof proof.json
```

For everything else, see the **[complete documentation](https://www.eventfoundation.io/docs/eventsourcingdb/merkle-cli)**.

## Running Quality Assurance

To verify that the tool is working correctly during development, run the quality assurance checks:

```shell
npm run qa
```
