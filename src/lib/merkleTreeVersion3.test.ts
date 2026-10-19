import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { buildTree, hashLeaf } from './merkleTreeVersion2.js';
import { buildVersion3Tree, calculateVersion3Root } from './merkleTreeVersion3.js';

const getLeafHashes = (count: number): Buffer[] =>
	Array.from({ length: count }, (_, index) => hashLeaf(Buffer.from(`${index}`)));

describe('the Merkle tree of version 3', () => {
	it('hashes the size of the tree, as 8 bytes, big-endian, together with the root of version 2', () => {
		const leafHashes = getLeafHashes(5);
		const size = Buffer.from([0, 0, 0, 0, 0, 0, 0, 5]);

		assert.deepStrictEqual(
			buildVersion3Tree(leafHashes).root,
			createHash('sha256')
				.update(Buffer.from([0x02]))
				.update(size)
				.update(buildTree(leafHashes).root)
				.digest(),
		);
	});

	it('builds the audit path of version 2, without the sides of the siblings', () => {
		const leafHashes = getLeafHashes(5);

		for (let index = 0; index < leafHashes.length; index++) {
			assert.deepStrictEqual(
				buildVersion3Tree(leafHashes, index).auditPath,
				buildTree(leafHashes, index).auditPath.map(({ hash }) => hash),
			);
		}
	});

	// The trees of every size up to beyond a few powers of two, so that both
	// subtrees that are complete and subtrees that are not are on the paths.
	it('calculates the root from the audit path of every leaf, by its index and the size of the tree', () => {
		for (let count = 1; count <= 33; count++) {
			const leafHashes = getLeafHashes(count);

			for (let index = 0; index < count; index++) {
				const { root, auditPath } = buildVersion3Tree(leafHashes, index);
				const leafHash = leafHashes[index];
				assert.ok(leafHash);

				assert.deepStrictEqual(
					calculateVersion3Root(leafHash, BigInt(index), BigInt(count), auditPath),
					root,
					`leaf ${index} of ${count}`,
				);
			}
		}
	});

	it('leads from the audit path of a leaf to the root at no other index of a tree of any size', () => {
		for (let count = 1; count <= 17; count++) {
			const leafHashes = getLeafHashes(count);

			for (let index = 0; index < count; index++) {
				const { root, auditPath } = buildVersion3Tree(leafHashes, index);
				const leafHash = leafHashes[index];
				assert.ok(leafHash);

				for (let size = 1; size <= 2 * count; size++) {
					for (let otherIndex = 0; otherIndex < size; otherIndex++) {
						if (size === count && otherIndex === index) {
							continue;
						}

						assert.notDeepStrictEqual(
							calculateVersion3Root(leafHash, BigInt(otherIndex), BigInt(size), auditPath),
							root,
							`leaf ${index} of ${count} as leaf ${otherIndex} of ${size}`,
						);
					}
				}
			}
		}
	});

	it('calculates no root for a leaf beyond the tree', () => {
		const leafHashes = getLeafHashes(4);
		const { auditPath } = buildVersion3Tree(leafHashes, 3);
		const [, , , leafHash] = leafHashes;
		assert.ok(leafHash);

		assert.strictEqual(calculateVersion3Root(leafHash, 4n, 4n, auditPath), undefined);
	});

	it('calculates no root from an audit path with a sibling too many or too few', () => {
		const leafHashes = getLeafHashes(5);
		const { auditPath } = buildVersion3Tree(leafHashes, 1);
		const [, leafHash, , , extra] = leafHashes;
		assert.ok(leafHash && extra);

		assert.strictEqual(calculateVersion3Root(leafHash, 1n, 5n, [...auditPath, extra]), undefined);
		assert.strictEqual(calculateVersion3Root(leafHash, 1n, 5n, auditPath.slice(1)), undefined);
	});

	it('calculates no root for a tree whose size does not fit into 8 bytes', () => {
		const [leafHash] = getLeafHashes(1);
		assert.ok(leafHash);

		assert.strictEqual(calculateVersion3Root(leafHash, 0n, 2n ** 64n, []), undefined);
	});
});
