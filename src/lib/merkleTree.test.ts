import assert from 'node:assert';
import { describe, it } from 'node:test';
import { buildMerkleRoot, generateMerkleProof, verifyMerkleProof } from './merkleTree.js';

describe('buildMerkleRoot', () => {
	it('throws error for empty list', () => {
		assert.throws(() => buildMerkleRoot([]), {
			message: 'Cannot build Merkle root from empty list',
		});
	});

	it('returns the single hash for a list with one element', () => {
		const hash = 'abc123';
		const root = buildMerkleRoot([hash]);

		assert.strictEqual(root, hash);
	});

	it('builds correct Merkle root for two hashes', () => {
		const hashes = ['hash1', 'hash2'];
		const root = buildMerkleRoot(hashes);

		assert.strictEqual(typeof root, 'string');
		assert.strictEqual(root.length, 64);
	});

	it('builds correct Merkle root for four hashes', () => {
		const hashes = ['hash1', 'hash2', 'hash3', 'hash4'];
		const root = buildMerkleRoot(hashes);

		assert.strictEqual(typeof root, 'string');
		assert.strictEqual(root.length, 64);
	});

	it('handles odd number of hashes by duplicating the last one', () => {
		const hashes = ['hash1', 'hash2', 'hash3'];
		const root = buildMerkleRoot(hashes);

		assert.strictEqual(typeof root, 'string');
		assert.strictEqual(root.length, 64);
	});
});

describe('generateMerkleProof', () => {
	it('throws error if target hash not found', () => {
		const hashes = ['hash1', 'hash2', 'hash3'];

		assert.throws(() => generateMerkleProof(hashes, 'notfound'), {
			message: 'Target hash not found in the list',
		});
	});

	it('generates proof for single element', () => {
		const hashes = ['hash1'];
		const proof = generateMerkleProof(hashes, 'hash1');

		assert.strictEqual(proof.eventHash, 'hash1');
		assert.strictEqual(proof.siblingHashes.length, 0);
		assert.strictEqual(proof.merkleRoot, 'hash1');
	});

	it('generates proof for first element in pair', () => {
		const hashes = ['hash1', 'hash2'];
		const proof = generateMerkleProof(hashes, 'hash1');

		assert.strictEqual(proof.eventHash, 'hash1');
		assert.strictEqual(proof.siblingHashes.length, 1);
		assert.strictEqual(proof.siblingHashes[0].hash, 'hash2');
		assert.strictEqual(proof.siblingHashes[0].position, 'right');
	});

	it('generates proof for second element in pair', () => {
		const hashes = ['hash1', 'hash2'];
		const proof = generateMerkleProof(hashes, 'hash2');

		assert.strictEqual(proof.eventHash, 'hash2');
		assert.strictEqual(proof.siblingHashes.length, 1);
		assert.strictEqual(proof.siblingHashes[0].hash, 'hash1');
		assert.strictEqual(proof.siblingHashes[0].position, 'left');
	});

	it('generates proof for element in larger tree', () => {
		const hashes = ['hash1', 'hash2', 'hash3', 'hash4'];
		const proof = generateMerkleProof(hashes, 'hash3');

		assert.strictEqual(proof.eventHash, 'hash3');
		assert.strictEqual(proof.siblingHashes.length, 2);
	});
});

describe('verifyMerkleProof', () => {
	it('verifies valid proof for single element', () => {
		const hashes = ['hash1'];
		const proof = generateMerkleProof(hashes, 'hash1');

		assert.strictEqual(verifyMerkleProof(proof), true);
	});

	it('verifies valid proof for two elements', () => {
		const hashes = ['hash1', 'hash2'];
		const proof = generateMerkleProof(hashes, 'hash1');

		assert.strictEqual(verifyMerkleProof(proof), true);
	});

	it('verifies valid proof for four elements', () => {
		const hashes = ['hash1', 'hash2', 'hash3', 'hash4'];
		const proof = generateMerkleProof(hashes, 'hash3');

		assert.strictEqual(verifyMerkleProof(proof), true);
	});

	it('rejects invalid proof with wrong root', () => {
		const hashes = ['hash1', 'hash2'];
		const proof = generateMerkleProof(hashes, 'hash1');
		proof.merkleRoot = 'wrongroot';

		assert.strictEqual(verifyMerkleProof(proof), false);
	});

	it('rejects invalid proof with tampered sibling', () => {
		const hashes = ['hash1', 'hash2', 'hash3', 'hash4'];
		const proof = generateMerkleProof(hashes, 'hash3');
		proof.siblingHashes[0].hash = 'tampered';

		assert.strictEqual(verifyMerkleProof(proof), false);
	});
});
