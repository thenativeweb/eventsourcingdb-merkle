import assert from 'node:assert';
import { createHash, createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
	calculateMerkleRoot,
	findProofStructureProblem,
	generateMerkleProof,
	getMerkleTreeVersion,
	verifyMerkleProof,
} from './merkleTree.js';
import { buildVersion1Root } from './merkleTreeVersion1.js';

const hashes = ['abc123', 'esdb:hash:v2:def456', 'esdb:hash:v2:0789ab'];
const saltKey = Buffer.from(
	'00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
	'hex',
);

const sha256 = (...parts: (Buffer | string)[]): Buffer => {
	const hash = createHash('sha256');
	for (const part of parts) {
		hash.update(part);
	}

	return hash.digest();
};

// The tree of version 2 over the three hashes, calculated here step by step: a
// leaf is the hash of 0x00 followed by its salt, if any, and the stored hash as
// text, and an inner node the hash of 0x01 followed by its children. Of three
// leaves, the first two form a subtree, next to which the third one stands.
const getExpectedTree = (salts: (Buffer | undefined)[]) => {
	const leaves = hashes.map((hash, index) =>
		sha256(Buffer.from([0x00]), salts[index] ?? Buffer.alloc(0), hash),
	);
	const [first, second, third] = leaves as [Buffer, Buffer, Buffer];
	const firstTwo = sha256(Buffer.from([0x01]), first, second);
	const root = sha256(Buffer.from([0x01]), firstTwo, third);

	return { leaves, firstTwo, root: `esdb:merkle:v2:${root.toString('hex')}` };
};

const getSalt = (hash: string): Buffer => createHmac('sha256', saltKey).update(hash).digest();

describe('calculateMerkleRoot', () => {
	it('calculates the root of version 1 as before', () => {
		assert.strictEqual(calculateMerkleRoot(hashes, { treeVersion: 1 }), buildVersion1Root(hashes));
	});

	it('calculates the root of version 2 over the stored hashes, marked with its version', () => {
		assert.strictEqual(calculateMerkleRoot(hashes, { treeVersion: 2 }), getExpectedTree([]).root);
	});

	it('salts the leaves of version 2 with the HMAC of the stored hash under the key', () => {
		assert.strictEqual(
			calculateMerkleRoot(hashes, { treeVersion: 2, saltKey }),
			getExpectedTree(hashes.map(getSalt)).root,
		);
	});

	it('refuses an empty list in either version', () => {
		for (const treeVersion of [1, 2] as const) {
			assert.throws(() => calculateMerkleRoot([], { treeVersion }), {
				message: 'Cannot build Merkle root from empty list',
			});
		}
	});
});

describe('generateMerkleProof', () => {
	it('proves an event in version 2 without a salt', () => {
		const expected = getExpectedTree([]);

		assert.deepStrictEqual(generateMerkleProof(hashes, 0, { treeVersion: 2 }), {
			eventHash: 'abc123',
			siblingHashes: [
				{ hash: expected.leaves[1]?.toString('hex'), position: 'right' },
				{ hash: expected.leaves[2]?.toString('hex'), position: 'right' },
			],
			merkleRoot: expected.root,
		});
	});

	it('proves an event in version 2 with its salt', () => {
		const expected = getExpectedTree(hashes.map(getSalt));

		assert.deepStrictEqual(generateMerkleProof(hashes, 2, { treeVersion: 2, saltKey }), {
			eventHash: 'esdb:hash:v2:0789ab',
			salt: getSalt('esdb:hash:v2:0789ab').toString('hex'),
			siblingHashes: [{ hash: expected.firstTwo.toString('hex'), position: 'left' }],
			merkleRoot: expected.root,
		});
	});

	it('names the salt right after the hash of the event', () => {
		const proof = generateMerkleProof(hashes, 1, { treeVersion: 2, saltKey });

		assert.deepStrictEqual(Object.keys(proof), [
			'eventHash',
			'salt',
			'siblingHashes',
			'merkleRoot',
		]);
	});

	it('proves an event in version 1 as before', () => {
		const proof = generateMerkleProof(hashes, 1, { treeVersion: 1 });

		assert.strictEqual(proof.merkleRoot, buildVersion1Root(hashes));
		assert.strictEqual(proof.salt, undefined);
		assert.strictEqual(verifyMerkleProof(proof), true);
	});
});

describe('verifyMerkleProof', () => {
	for (const [name, options] of [
		['without a salt', { treeVersion: 2 }],
		['with a salt', { treeVersion: 2, saltKey }],
	] as const) {
		it(`verifies every proof of version 2 ${name}`, () => {
			for (let index = 0; index < hashes.length; index++) {
				assert.strictEqual(verifyMerkleProof(generateMerkleProof(hashes, index, options)), true);
			}
		});
	}

	const proof = generateMerkleProof(hashes, 0, { treeVersion: 2, saltKey });

	// Changes the first sibling of the proof, which lies on its right, and keeps
	// the others.
	const changeFirstSibling = (
		change: (sibling: { hash: string; position: string }) => Record<string, string>,
	): unknown => ({
		...proof,
		siblingHashes: proof.siblingHashes.map((sibling, index) =>
			index === 0 ? { ...sibling, ...change(sibling) } : sibling,
		),
	});

	for (const [name, tampered] of [
		['another event hash', { ...proof, eventHash: 'abc124' }],
		['another salt', { ...proof, salt: getSalt('abc124').toString('hex') }],
		['no salt', { ...proof, salt: undefined }],
		['another root', { ...proof, merkleRoot: getExpectedTree([]).root }],
		['a root without the version', { ...proof, merkleRoot: proof.merkleRoot.slice(15) }],
		['a sibling on the other side', changeFirstSibling(() => ({ position: 'left' }))],
		[
			'a sibling with more than its hash',
			changeFirstSibling(({ hash }) => ({ hash: `${hash}00` })),
		],
		[
			'a sibling with text after its hash',
			changeFirstSibling(({ hash }) => ({ hash: `${hash}zz` })),
		],
		['a sibling on neither side', changeFirstSibling(() => ({ position: 'middle' }))],
		['a sibling less', { ...proof, siblingHashes: proof.siblingHashes.slice(1) }],
	] as const) {
		it(`rejects a proof of version 2 with ${name}`, () => {
			assert.strictEqual(verifyMerkleProof(tampered as unknown as typeof proof), false);
		});
	}
});

describe('getMerkleTreeVersion', () => {
	it('takes a root without a version for one of version 1', () => {
		assert.strictEqual(getMerkleTreeVersion(buildVersion1Root(hashes)), 1);
	});

	it('takes a root that names version 2 for one of version 2', () => {
		assert.strictEqual(getMerkleTreeVersion(getExpectedTree([]).root), 2);
	});

	it('refuses a root of a version it does not know', () => {
		assert.throws(() => getMerkleTreeVersion('esdb:merkle:v3:abc'), {
			name: 'UnsupportedMerkleTreeVersionError',
			message: 'Unsupported Merkle tree version: v3',
		});
	});
});

describe('findProofStructureProblem', () => {
	const fieldsProblem = 'Must contain eventHash, merkleRoot, and siblingHashes';
	const version1Proof = generateMerkleProof(hashes, 0, { treeVersion: 1 });
	const version2Proof = generateMerkleProof(hashes, 0, { treeVersion: 2, saltKey });

	for (const [name, proof, problem] of [
		['a proof of version 1', version1Proof, undefined],
		['a proof of version 2 with a salt', version2Proof, undefined],
		['a proof of version 2 without a salt', { ...version2Proof, salt: undefined }, undefined],
		['no object', 'abc', fieldsProblem],
		['null', null, fieldsProblem],
		['an object without fields', {}, fieldsProblem],
		['an event hash that is no text', { ...version2Proof, eventHash: 1 }, fieldsProblem],
		['an empty event hash', { ...version2Proof, eventHash: '' }, fieldsProblem],
		['an empty root', { ...version2Proof, merkleRoot: '' }, fieldsProblem],
		['a root that is no text', { ...version2Proof, merkleRoot: 1 }, fieldsProblem],
		['siblings that are no list', { ...version2Proof, siblingHashes: {} }, fieldsProblem],
		[
			'a proof of version 1 with a salt',
			{ ...version1Proof, salt: version2Proof.salt },
			'A proof of Merkle tree version 1 has no salt',
		],
		[
			'a salt of fewer digits',
			{ ...version2Proof, salt: version2Proof.salt?.slice(1) },
			'The salt has to be 64 hexadecimal digits',
		],
		[
			'a salt that is no text',
			{ ...version2Proof, salt: null },
			'The salt has to be 64 hexadecimal digits',
		],
	] as const) {
		it(`finds ${problem === undefined ? 'nothing' : 'a problem'} in ${name}`, () => {
			assert.strictEqual(findProofStructureProblem(proof), problem);
		});
	}

	it('refuses a proof of a version it does not know', () => {
		assert.throws(
			() => findProofStructureProblem({ ...version2Proof, merkleRoot: 'esdb:merkle:v3:abc' }),
			{ message: 'Unsupported Merkle tree version: v3' },
		);
	});
});
