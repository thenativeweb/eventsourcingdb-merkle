import assert from 'node:assert';
import { createHash, createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
	calculateMerkleRoot,
	findProofStructureProblem,
	generateMerkleProof,
	getMerkleTreeVersion,
	type MerkleTreeOptions,
	verifyMerkleProof,
} from './merkleTree.js';
import { buildVersion1Root } from './merkleTreeVersion1.js';
import type { MerkleProofVersion3, MerkleProofWithSides } from './types.js';

const sha256 = (...parts: (Buffer | string)[]): Buffer => {
	const hash = createHash('sha256');
	for (const part of parts) {
		hash.update(part);
	}

	return hash.digest();
};

// Stored hashes of either version, in the form in which EventSourcingDB stores
// them.
const hashes = [
	sha256('first').toString('hex'),
	`esdb:hash:v2:${sha256('second').toString('hex')}`,
	`esdb:hash:v2:${sha256('third').toString('hex')}`,
];
const [firstHash = '', secondHash = '', thirdHash = ''] = hashes;
const saltKey = Buffer.from(
	'00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
	'hex',
);

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

	// The root of version 3 is the hash of 0x02 followed by the size of the tree
	// as 8 bytes, big-endian, and the root of version 2.
	const size = Buffer.alloc(8);
	size.writeBigUInt64BE(BigInt(leaves.length));
	const version3Root = sha256(Buffer.from([0x02]), size, root);

	return {
		leaves,
		firstTwo,
		root: `esdb:merkle:v2:${root.toString('hex')}`,
		version3Root: `esdb:merkle:v3:${version3Root.toString('hex')}`,
	};
};

const getSalt = (hash: string): Buffer => createHmac('sha256', saltKey).update(hash).digest();

// The proof of an event with its ID, as get-proof gives it, in a tree whose
// version decides which of the two kinds of proofs it is.
const proveWithSides = (index: number, options: MerkleTreeOptions): MerkleProofWithSides =>
	({
		eventId: String(index),
		...generateMerkleProof(hashes, index, options),
	}) as MerkleProofWithSides;

const proveVersion3 = (
	index: number,
	options: MerkleTreeOptions,
	proofHashes = hashes,
): MerkleProofVersion3 =>
	({
		eventId: String(index),
		...generateMerkleProof(proofHashes, index, options),
	}) as MerkleProofVersion3;

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

	it('calculates the root of version 3 over the size of the tree and its root of version 2', () => {
		assert.strictEqual(
			calculateMerkleRoot(hashes, { treeVersion: 3 }),
			getExpectedTree([]).version3Root,
		);
	});

	it('salts the leaves of version 3 as those of version 2', () => {
		assert.strictEqual(
			calculateMerkleRoot(hashes, { treeVersion: 3, saltKey }),
			getExpectedTree(hashes.map(getSalt)).version3Root,
		);
	});

	it('refuses an empty list in every version', () => {
		for (const treeVersion of [1, 2, 3] as const) {
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
			eventHash: firstHash,
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
			eventHash: thirdHash,
			salt: getSalt(thirdHash).toString('hex'),
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

	it('proves an event in version 3 without a salt, with the ID of the last event', () => {
		const expected = getExpectedTree([]);

		assert.deepStrictEqual(generateMerkleProof(hashes, 0, { treeVersion: 3 }), {
			eventHash: firstHash,
			siblingHashes: [expected.leaves[1]?.toString('hex'), expected.leaves[2]?.toString('hex')],
			merkleRoot: expected.version3Root,
			lastEventId: '2',
		});
	});

	it('proves an event in version 3 with its salt', () => {
		const expected = getExpectedTree(hashes.map(getSalt));

		assert.deepStrictEqual(generateMerkleProof(hashes, 2, { treeVersion: 3, saltKey }), {
			eventHash: thirdHash,
			salt: getSalt(thirdHash).toString('hex'),
			siblingHashes: [expected.firstTwo.toString('hex')],
			merkleRoot: expected.version3Root,
			lastEventId: '2',
		});
	});

	it('names the ID of the last event in version 3 right after the root', () => {
		const proof = generateMerkleProof(hashes, 1, { treeVersion: 3, saltKey });

		assert.deepStrictEqual(Object.keys(proof), [
			'eventHash',
			'salt',
			'siblingHashes',
			'merkleRoot',
			'lastEventId',
		]);
	});

	it('proves an event in version 1 as before', () => {
		const proof = proveWithSides(1, { treeVersion: 1 });

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
				assert.strictEqual(verifyMerkleProof(proveWithSides(index, options)), true);
			}
		});
	}

	const proof = proveWithSides(0, { treeVersion: 2, saltKey });

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
		['another event hash', { ...proof, eventHash: secondHash }],
		['another salt', { ...proof, salt: getSalt(secondHash).toString('hex') }],
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

	// The data of a leaf is its salt followed by the stored hash, so moving the
	// first 32 bytes of the hash into the salt keeps the data of the leaf, and
	// only the form of the hash tells the two apart.
	it('rejects a proof of version 2 that names the first bytes of its event hash as its salt', () => {
		const unsalted = proveWithSides(1, { treeVersion: 2 });
		const forged = {
			...unsalted,
			salt: Buffer.from(secondHash).subarray(0, 32).toString('hex'),
			eventHash: secondHash.slice(32),
		};

		assert.strictEqual(verifyMerkleProof(unsalted), true);
		assert.strictEqual(verifyMerkleProof(forged), false);
	});
});

describe('verifyMerkleProof of version 3', () => {
	for (const [name, options] of [
		['without a salt', { treeVersion: 3 }],
		['with a salt', { treeVersion: 3, saltKey }],
	] as const) {
		it(`verifies every proof of version 3 ${name}, under the ID of its event`, () => {
			for (let index = 0; index < hashes.length; index++) {
				assert.strictEqual(verifyMerkleProof(proveVersion3(index, options)), true);
			}
		});
	}

	const proof = proveVersion3(1, { treeVersion: 3, saltKey });
	const [firstSibling = '', secondSibling = ''] = proof.siblingHashes;

	for (const [name, tampered] of [
		['another event ID', { ...proof, eventId: '0' }],
		['the event ID of the last event', { ...proof, eventId: '2' }],
		['an event ID beyond the last event', { ...proof, eventId: '3' }],
		['a last event ID before its own', { ...proof, lastEventId: '1' }],
		['a last event ID after its own', { ...proof, lastEventId: '3' }],
		// The size of the tree is one more than the ID of its last event, and a path
		// of 64 siblings leads to the top of a tree of 2^64 leaves.
		[
			'a tree larger than 8 bytes can count',
			{
				...proof,
				lastEventId: String(2n ** 64n - 1n),
				siblingHashes: Array.from({ length: 64 }, () => firstSibling),
			},
		],
		['another event hash', { ...proof, eventHash: thirdHash }],
		['another salt', { ...proof, salt: getSalt(thirdHash).toString('hex') }],
		['no salt', { ...proof, salt: undefined }],
		['another root', { ...proof, merkleRoot: getExpectedTree([]).version3Root }],
		[
			'the root of version 2 of the same tree',
			{ ...proof, merkleRoot: getExpectedTree(hashes.map(getSalt)).root },
		],
		['a sibling less', { ...proof, siblingHashes: [firstSibling] }],
		['a sibling more', { ...proof, siblingHashes: [firstSibling, secondSibling, firstSibling] }],
		['its siblings in another order', { ...proof, siblingHashes: [secondSibling, firstSibling] }],
	] as const) {
		it(`rejects a proof of version 3 with ${name}`, () => {
			assert.strictEqual(verifyMerkleProof(tampered as MerkleProofVersion3), false);
		});
	}

	// The path of the second of two events leads to the root from the third of
	// three events as well, if the first sibling is taken for the root of the
	// first two events, so only the size that the root covers tells the two apart.
	it('rejects a proof of version 3 that names another event of a tree of another size', () => {
		const honest = proveVersion3(1, { treeVersion: 3 }, hashes.slice(0, 2));

		assert.strictEqual(verifyMerkleProof(honest), true);
		assert.strictEqual(verifyMerkleProof({ ...honest, eventId: '2', lastEventId: '2' }), false);
	});
});

describe('getMerkleTreeVersion', () => {
	it('takes a root without a version for one of version 1', () => {
		assert.strictEqual(getMerkleTreeVersion(buildVersion1Root(hashes)), 1);
	});

	it('takes a root that names version 2 for one of version 2', () => {
		assert.strictEqual(getMerkleTreeVersion(getExpectedTree([]).root), 2);
	});

	it('takes a root that names version 3 for one of version 3', () => {
		assert.strictEqual(getMerkleTreeVersion(getExpectedTree([]).version3Root), 3);
	});

	it('refuses a root of a version it does not know', () => {
		assert.throws(() => getMerkleTreeVersion('esdb:merkle:v4:abc'), {
			name: 'UnsupportedMerkleTreeVersionError',
			message: 'Unsupported Merkle tree version: v4',
		});
	});
});

describe('findProofStructureProblem', () => {
	const fieldsProblem = 'Must contain eventHash, merkleRoot, and siblingHashes';
	const version1Proof = proveWithSides(0, { treeVersion: 1 });
	const version2Proof = proveWithSides(0, { treeVersion: 2, saltKey });

	const eventHashProblem = 'The event hash has to be a hash of version 1 or 2';
	const siblingProblem =
		'Every sibling has to have a hash of 64 hexadecimal digits, and the position left or right';
	const [sibling] = version2Proof.siblingHashes;
	const withFirstSibling = (firstSibling: unknown): unknown => ({
		...version2Proof,
		siblingHashes: [firstSibling, ...version2Proof.siblingHashes.slice(1)],
	});

	for (const [name, proof, problem] of [
		['a proof of version 1', version1Proof, undefined],
		[
			'a proof of version 1 of any event hash',
			{ ...version1Proof, eventHash: 'abc123' },
			undefined,
		],
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
		['an event hash of version 2', { ...version2Proof, eventHash: secondHash }, undefined],
		['an event hash that is no hash', { ...version2Proof, eventHash: 'abc123' }, eventHashProblem],
		[
			'an event hash without its first bytes',
			{ ...version2Proof, eventHash: secondHash.slice(32) },
			eventHashProblem,
		],
		[
			'an event hash in upper case',
			{ ...version2Proof, eventHash: firstHash.toUpperCase() },
			eventHashProblem,
		],
		[
			'an event hash of a version the tool does not know',
			{ ...version2Proof, eventHash: secondHash.replace('v2', 'v3') },
			eventHashProblem,
		],
		[
			'a sibling with text after its hash',
			withFirstSibling({ ...sibling, hash: `${sibling?.hash}zz` }),
			siblingProblem,
		],
		[
			'a sibling with a digit too few',
			withFirstSibling({ ...sibling, hash: sibling?.hash.slice(1) }),
			siblingProblem,
		],
		[
			'a sibling on neither side',
			withFirstSibling({ ...sibling, position: 'middle' }),
			siblingProblem,
		],
		['a sibling that is no object', withFirstSibling('abc123'), siblingProblem],
		['a sibling that is null', withFirstSibling(null), siblingProblem],
	] as const) {
		it(`finds ${problem === undefined ? 'nothing' : 'a problem'} in ${name}`, () => {
			assert.strictEqual(findProofStructureProblem(proof), problem);
		});
	}

	describe('of version 3', () => {
		const version3Proof = proveVersion3(0, { treeVersion: 3, saltKey });
		const idsProblem = 'A proof of Merkle tree version 3 has to contain eventId and lastEventId';
		const eventIdProblem = 'The event ID has to be digits alone, without a sign or leading zeros';
		const lastEventIdProblem =
			'The last event ID has to be digits alone, without a sign or leading zeros';
		const version3SiblingProblem = 'Every sibling has to be a hash of 64 hexadecimal digits';
		const [version3Sibling = ''] = version3Proof.siblingHashes;
		const withFirstVersion3Sibling = (firstSibling: unknown): unknown => ({
			...version3Proof,
			siblingHashes: [firstSibling, ...version3Proof.siblingHashes.slice(1)],
		});

		for (const [name, proof, problem] of [
			['a proof of version 3 with a salt', version3Proof, undefined],
			['a proof of version 3 without a salt', { ...version3Proof, salt: undefined }, undefined],
			[
				'a proof of version 3 of an event that the tree does not hold',
				{ ...version3Proof, eventId: '10' },
				undefined,
			],
			[
				'a proof of version 1 with a last event ID',
				{ ...version1Proof, lastEventId: '2' },
				'A proof of Merkle tree version 1 has no last event ID',
			],
			[
				'a proof of version 2 with a last event ID',
				{ ...version2Proof, lastEventId: '2' },
				'A proof of Merkle tree version 2 has no last event ID',
			],
			['a proof without an event ID', { ...version3Proof, eventId: undefined }, idsProblem],
			['a proof without a last event ID', { ...version3Proof, lastEventId: undefined }, idsProblem],
			[
				'a proof without a last event ID before its event hash',
				{ ...version3Proof, lastEventId: undefined, eventHash: 'abc123' },
				idsProblem,
			],
			['an event ID with a leading zero', { ...version3Proof, eventId: '00' }, eventIdProblem],
			['an event ID with a sign', { ...version3Proof, eventId: '+0' }, eventIdProblem],
			['an event ID that is no number', { ...version3Proof, eventId: 'abc' }, eventIdProblem],
			['an empty event ID', { ...version3Proof, eventId: '' }, eventIdProblem],
			['an event ID that is no text', { ...version3Proof, eventId: 0 }, eventIdProblem],
			[
				'an event ID before the event hash',
				{ ...version3Proof, eventId: '00', eventHash: 'abc123' },
				eventIdProblem,
			],
			[
				'a last event ID with a leading zero',
				{ ...version3Proof, lastEventId: '02' },
				lastEventIdProblem,
			],
			['a last event ID with a sign', { ...version3Proof, lastEventId: '-2' }, lastEventIdProblem],
			['a last event ID that is no text', { ...version3Proof, lastEventId: 2 }, lastEventIdProblem],
			[
				'an event hash of version 3 that is no hash',
				{ ...version3Proof, eventHash: 'abc123' },
				eventHashProblem,
			],
			[
				'a salt of version 3 of fewer digits',
				{ ...version3Proof, salt: version3Proof.salt?.slice(1) },
				'The salt has to be 64 hexadecimal digits',
			],
			[
				'a sibling of version 3 with a side',
				withFirstVersion3Sibling({ hash: version3Sibling, position: 'right' }),
				version3SiblingProblem,
			],
			[
				'a sibling of version 3 with text after its hash',
				withFirstVersion3Sibling(`${version3Sibling}zz`),
				version3SiblingProblem,
			],
			[
				'a sibling of version 3 that is null',
				withFirstVersion3Sibling(null),
				version3SiblingProblem,
			],
			[
				'a sibling of version 3 before the last event ID',
				{ ...(withFirstVersion3Sibling(null) as object), lastEventId: '02' },
				version3SiblingProblem,
			],
			['a sibling of version 2 without a side', withFirstSibling(sibling?.hash), siblingProblem],
		] as const) {
			it(`finds ${problem === undefined ? 'nothing' : 'a problem'} in ${name}`, () => {
				assert.strictEqual(findProofStructureProblem(proof), problem);
			});
		}
	});

	it('refuses a proof of a version it does not know', () => {
		assert.throws(
			() => findProofStructureProblem({ ...version2Proof, merkleRoot: 'esdb:merkle:v4:abc' }),
			{ message: 'Unsupported Merkle tree version: v4' },
		);
	});
});
