import { createHash } from 'node:crypto';
import { buildTree, hashNode } from './merkleTreeVersion2.js';

// The tree of version 3 is the tree of version 2, but its root covers the size
// of the tree as well. A proof of version 3 locates its leaf by the index and
// the size of the tree, as RFC 9162 does, and the index of an event is its ID.
// RFC 9162 binds the index only where the size is known, though: a path that
// leads to the root from one leaf of a tree of one size can lead to it from a
// leaf at another index of a tree of another size. Certificate Transparency
// signs the size along with the root, but a root that the tool calculates is
// published as it is, so the root hashes the size in, behind a byte of its own,
// as RFC 6962 puts one in front of a leaf and of an inner node.
const rootPrefix = Buffer.from([0x02]);

// RFC 6962 encodes the size of a tree in 8 bytes, as it does in a tree head, so
// a tree has at most 2^64 - 1 leaves.
const treeSizeLength = 8;
const maximumTreeSize = 2n ** 64n - 1n;

const hashRoot = (treeSize: bigint, root: Buffer): Buffer => {
	const size = Buffer.alloc(treeSizeLength);
	size.writeBigUInt64BE(treeSize);

	return createHash('sha256').update(rootPrefix).update(size).update(root).digest();
};

export const buildVersion3Tree = (
	leafHashes: Buffer[],
	index?: number,
): { root: Buffer; auditPath: Buffer[] } => {
	const { root, auditPath } = buildTree(leafHashes, index);

	return {
		root: hashRoot(BigInt(leafHashes.length), root),
		auditPath: auditPath.map(({ hash }) => hash),
	};
};

// calculateVersion3Root calculates the root from the audit path of the leaf at
// the given index of a tree of the given size, as section 2.1.3.2 of RFC 9162
// verifies an inclusion proof, or returns undefined where the path does not fit
// that leaf in that tree. The side of each sibling follows from the index of the
// node on the path and the last index of its level: a node with an odd index is
// a right child, and so is the last node of a level, which has no partner on its
// right and is moved up unchanged until it is one. Both indexes halve from one
// level to the next, and the path fits where it ends at the level of the root.
export const calculateVersion3Root = (
	leafHash: Buffer,
	leafIndex: bigint,
	treeSize: bigint,
	auditPath: Buffer[],
): Buffer | undefined => {
	if (leafIndex >= treeSize || treeSize > maximumTreeSize) {
		return undefined;
	}

	let index = leafIndex;
	let lastIndex = treeSize - 1n;
	let hash = leafHash;

	for (const sibling of auditPath) {
		if (lastIndex === 0n) {
			return undefined;
		}

		if (index % 2n === 1n || index === lastIndex) {
			hash = hashNode(sibling, hash);
			while (index % 2n === 0n && index !== 0n) {
				index /= 2n;
				lastIndex /= 2n;
			}
		} else {
			hash = hashNode(hash, sibling);
		}

		index /= 2n;
		lastIndex /= 2n;
	}

	if (lastIndex !== 0n) {
		return undefined;
	}

	return hashRoot(treeSize, hash);
};
