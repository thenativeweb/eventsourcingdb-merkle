import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
	buildVersion1Root,
	generateVersion1Proof,
	verifyVersion1Proof,
} from './merkleTreeVersion1.js';

describe('buildVersion1Root', () => {
	it('throws error for empty list', () => {
		assert.throws(() => buildVersion1Root([]), {
			message: 'Cannot build Merkle root from empty list',
		});
	});

	it('returns the single hash for a list with one element', () => {
		const hash = 'abc123';
		const root = buildVersion1Root([hash]);

		assert.strictEqual(root, hash);
	});

	it('builds correct Merkle root for two hashes', () => {
		const hashes = ['hash1', 'hash2'];
		const root = buildVersion1Root(hashes);

		assert.strictEqual(typeof root, 'string');
		assert.strictEqual(root.length, 64);
	});

	it('builds correct Merkle root for four hashes', () => {
		const hashes = ['hash1', 'hash2', 'hash3', 'hash4'];
		const root = buildVersion1Root(hashes);

		assert.strictEqual(typeof root, 'string');
		assert.strictEqual(root.length, 64);
	});

	it('handles odd number of hashes by duplicating the last one', () => {
		const hashes = ['hash1', 'hash2', 'hash3'];
		const root = buildVersion1Root(hashes);

		assert.strictEqual(typeof root, 'string');
		assert.strictEqual(root.length, 64);
	});
});

describe('generateVersion1Proof', () => {
	it('throws error if target hash not found', () => {
		const hashes = ['hash1', 'hash2', 'hash3'];

		assert.throws(() => generateVersion1Proof(hashes, 'notfound'), {
			message: 'Target hash not found in the list',
		});
	});

	it('generates proof for single element', () => {
		const hashes = ['hash1'];
		const proof = generateVersion1Proof(hashes, 'hash1');

		assert.strictEqual(proof.eventHash, 'hash1');
		assert.strictEqual(proof.siblingHashes.length, 0);
		assert.strictEqual(proof.merkleRoot, 'hash1');
	});

	it('generates proof for first element in pair', () => {
		const hashes = ['hash1', 'hash2'];
		const proof = generateVersion1Proof(hashes, 'hash1');

		assert.strictEqual(proof.eventHash, 'hash1');
		assert.strictEqual(proof.siblingHashes.length, 1);
		const [sibling] = proof.siblingHashes;
		assert.ok(sibling);
		assert.strictEqual(sibling.hash, 'hash2');
		assert.strictEqual(sibling.position, 'right');
	});

	it('generates proof for second element in pair', () => {
		const hashes = ['hash1', 'hash2'];
		const proof = generateVersion1Proof(hashes, 'hash2');

		assert.strictEqual(proof.eventHash, 'hash2');
		assert.strictEqual(proof.siblingHashes.length, 1);
		const [sibling] = proof.siblingHashes;
		assert.ok(sibling);
		assert.strictEqual(sibling.hash, 'hash1');
		assert.strictEqual(sibling.position, 'left');
	});

	it('generates proof for element in larger tree', () => {
		const hashes = ['hash1', 'hash2', 'hash3', 'hash4'];
		const proof = generateVersion1Proof(hashes, 'hash3');

		assert.strictEqual(proof.eventHash, 'hash3');
		assert.strictEqual(proof.siblingHashes.length, 2);
	});
});

describe('verifyVersion1Proof', () => {
	it('verifies valid proof for single element', () => {
		const hashes = ['hash1'];
		const proof = generateVersion1Proof(hashes, 'hash1');

		assert.strictEqual(verifyVersion1Proof(proof), true);
	});

	it('verifies valid proof for two elements', () => {
		const hashes = ['hash1', 'hash2'];
		const proof = generateVersion1Proof(hashes, 'hash1');

		assert.strictEqual(verifyVersion1Proof(proof), true);
	});

	it('verifies valid proof for four elements', () => {
		const hashes = ['hash1', 'hash2', 'hash3', 'hash4'];
		const proof = generateVersion1Proof(hashes, 'hash3');

		assert.strictEqual(verifyVersion1Proof(proof), true);
	});

	it('rejects invalid proof with wrong root', () => {
		const hashes = ['hash1', 'hash2'];
		const proof = generateVersion1Proof(hashes, 'hash1');
		proof.merkleRoot = 'wrongroot';

		assert.strictEqual(verifyVersion1Proof(proof), false);
	});

	it('rejects invalid proof with tampered sibling', () => {
		const hashes = ['hash1', 'hash2', 'hash3', 'hash4'];
		const proof = generateVersion1Proof(hashes, 'hash3');
		const [sibling] = proof.siblingHashes;
		assert.ok(sibling);
		sibling.hash = 'tampered';

		assert.strictEqual(verifyVersion1Proof(proof), false);
	});
});
