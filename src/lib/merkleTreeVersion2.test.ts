import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
	type AuditPathNode,
	buildTree,
	calculateRootFromAuditPath,
	hashLeaf,
	hashNode,
} from './merkleTreeVersion2.js';

// The test vectors of the Merkle tree from the specification of
// eventsourcingdb-auditing, whose tree follows RFC 6962 as well: five leaves,
// the data of each of which is a salt followed by the hash of a receipt.
const testVectors = {
	leaves: [
		{
			salt: '1010101010101010101010101010101010101010101010101010101010101010',
			receiptHash: 'c8eaf00e6131e64a98f9c04aac4b25ab38afa196c1afc51f6589af7d7f13b588',
			leafHash: '83ed52f2eb6213598795cf2bc18ee93e39bf238730f9177e8b8ce03b2b10968a',
		},
		{
			salt: '1111111111111111111111111111111111111111111111111111111111111111',
			receiptHash: '2121212121212121212121212121212121212121212121212121212121212121',
			leafHash: '9bcf1197c6ae755d26c1ee7ef27526a95ae07fd8d6be6d46ff6b9acd8dce8e10',
		},
		{
			salt: '1212121212121212121212121212121212121212121212121212121212121212',
			receiptHash: '2222222222222222222222222222222222222222222222222222222222222222',
			leafHash: '40e912613c4d95b03d24f1afc451a90571cd4af0097e3ca3275772bbde8475bc',
		},
		{
			salt: '1313131313131313131313131313131313131313131313131313131313131313',
			receiptHash: '2323232323232323232323232323232323232323232323232323232323232323',
			leafHash: '93c4e60986474571b9a36c5f44c419faf682c93a8850ba77d251a7e2a4abc592',
		},
		{
			salt: '1414141414141414141414141414141414141414141414141414141414141414',
			receiptHash: '2424242424242424242424242424242424242424242424242424242424242424',
			leafHash: '4f35263fe4557c8b295f2282f7353d22bc59924d54f43c9bb3bcd2d034ff7ec7',
		},
	],
	root: 'f4d986eb1e650fcdf11488dcc61d82864f588cacfd77e7d2da539566e76cd0b2',
	proofs: [
		{
			leaf: 0,
			siblings: [
				{
					hash: '9bcf1197c6ae755d26c1ee7ef27526a95ae07fd8d6be6d46ff6b9acd8dce8e10',
					position: 'right',
				},
				{
					hash: '9d16589c9918be2554a6ce4f777f9e98ea3273c4637fd53451873e1d21253b92',
					position: 'right',
				},
				{
					hash: '4f35263fe4557c8b295f2282f7353d22bc59924d54f43c9bb3bcd2d034ff7ec7',
					position: 'right',
				},
			],
		},
		{
			leaf: 4,
			siblings: [
				{
					hash: '077160c164653b1034ace63a6995cae1aa9faa98c3e50e06b784882bc06e33c8',
					position: 'left',
				},
			],
		},
	],
} as const;

const fromHex = (hex: string): Buffer => Buffer.from(hex, 'hex');

const toHex = (auditPath: AuditPathNode[]): { hash: string; position: string }[] =>
	auditPath.map(({ hash, position }) => ({ hash: hash.toString('hex'), position }));

// The tree as RFC 6962 defines it in its section 2.1: the root of more than one
// leaf is the inner node over the root of the first k leaves and the root of the
// others, where k is the largest power of two smaller than their number, and the
// audit path of a leaf lists the roots of the subtrees next to it, from the
// bottom up.
const getSplitPoint = (count: number): number => {
	let splitPoint = 1;
	while (splitPoint * 2 < count) {
		splitPoint *= 2;
	}

	return splitPoint;
};

const getReferenceRoot = (leafHashes: Buffer[]): Buffer => {
	const [onlyLeafHash] = leafHashes;
	if (leafHashes.length === 1 && onlyLeafHash !== undefined) {
		return onlyLeafHash;
	}

	const splitPoint = getSplitPoint(leafHashes.length);

	return hashNode(
		getReferenceRoot(leafHashes.slice(0, splitPoint)),
		getReferenceRoot(leafHashes.slice(splitPoint)),
	);
};

const getReferenceAuditPath = (index: number, leafHashes: Buffer[]): AuditPathNode[] => {
	if (leafHashes.length === 1) {
		return [];
	}

	const splitPoint = getSplitPoint(leafHashes.length);
	const left = leafHashes.slice(0, splitPoint);
	const right = leafHashes.slice(splitPoint);

	if (index < splitPoint) {
		return [
			...getReferenceAuditPath(index, left),
			{ hash: getReferenceRoot(right), position: 'right' },
		];
	}

	return [
		...getReferenceAuditPath(index - splitPoint, right),
		{ hash: getReferenceRoot(left), position: 'left' },
	];
};

describe('the Merkle tree of version 2', () => {
	const leafHashes = testVectors.leaves.map(({ salt, receiptHash }) =>
		hashLeaf(Buffer.concat([fromHex(salt), fromHex(receiptHash)])),
	);

	it('hashes the leaves of the test vectors of eventsourcingdb-auditing', () => {
		assert.deepStrictEqual(
			leafHashes.map(leafHash => leafHash.toString('hex')),
			testVectors.leaves.map(({ leafHash }) => leafHash),
		);
	});

	it('calculates the root of the test vectors', () => {
		assert.strictEqual(buildTree(leafHashes).root.toString('hex'), testVectors.root);
	});

	for (const { leaf, siblings } of testVectors.proofs) {
		it(`builds the audit path of leaf ${leaf} of the test vectors`, () => {
			assert.deepStrictEqual(toHex(buildTree(leafHashes, leaf).auditPath), siblings);
		});

		it(`calculates the root of the test vectors from the audit path of leaf ${leaf}`, () => {
			const leafHash = leafHashes[leaf];
			assert.ok(leafHash);
			const auditPath = siblings.map(({ hash, position }) => ({ hash: fromHex(hash), position }));

			assert.strictEqual(
				calculateRootFromAuditPath(leafHash, auditPath).toString('hex'),
				testVectors.root,
			);
		});
	}

	// The test vectors hold one tree only, and a tree of five leaves has no
	// subtree of three, so the trees of every size up to beyond a few powers of
	// two are checked against the definition of RFC 6962.
	it('builds the tree of RFC 6962 for any number of leaves', () => {
		for (let count = 1; count <= 33; count++) {
			const hashes = Array.from({ length: count }, (_, index) => hashLeaf(Buffer.from(`${index}`)));

			for (let index = 0; index < count; index++) {
				const { root, auditPath } = buildTree(hashes, index);
				const leafHash = hashes[index];
				assert.ok(leafHash);

				assert.deepStrictEqual(root, getReferenceRoot(hashes), `root of ${count} leaves`);
				assert.deepStrictEqual(
					toHex(auditPath),
					toHex(getReferenceAuditPath(index, hashes)),
					`audit path of leaf ${index} of ${count}`,
				);
				assert.deepStrictEqual(calculateRootFromAuditPath(leafHash, auditPath), root);
			}
		}
	});

	it('gives a list of leaves another root than the same list with its last leaf twice', () => {
		const hashes = ['a', 'b', 'c'].map(data => hashLeaf(Buffer.from(data)));
		const [, , last] = hashes;
		assert.ok(last);

		assert.notDeepStrictEqual(buildTree([...hashes, last]).root, buildTree(hashes).root);
	});

	it('hashes an inner node unlike a leaf over the same bytes', () => {
		const [left, right] = leafHashes;
		assert.ok(left && right);

		assert.notDeepStrictEqual(hashNode(left, right), hashLeaf(Buffer.concat([left, right])));
	});

	it('refuses a tree without leaves', () => {
		assert.throws(() => buildTree([]), { message: 'Cannot build Merkle root from empty list' });
	});
});
