import { createHash } from 'node:crypto';

// A node next to the path from a leaf to the root, and the side of the path on
// which it lies.
export interface AuditPathNode {
	hash: Buffer;
	position: 'left' | 'right';
}

// RFC 6962 puts a byte of its own in front of what a leaf and an inner node
// hash, so that neither can pass for the other: without them, the hash of an
// inner node would also be the hash of a leaf whose data are the hashes of its
// children.
const leafPrefix = Buffer.from([0x00]);
const nodePrefix = Buffer.from([0x01]);

export const hashLeaf = (data: Buffer): Buffer =>
	createHash('sha256').update(leafPrefix).update(data).digest();

export const hashNode = (left: Buffer, right: Buffer): Buffer =>
	createHash('sha256').update(nodePrefix).update(left).update(right).digest();

// buildTree calculates the root of the tree over the hashes of its leaves, as
// RFC 6962 defines it, and the audit path of the leaf at the given index. RFC
// 6962 defines the tree by splitting the leaves at the largest power of two
// smaller than their number. Pairing the nodes level by level and moving a node
// that is left without a partner up unchanged builds the same tree, without
// copying the leaves for every subtree. The node is moved rather than paired
// with itself, since that would give a list of leaves the same root as the same
// list with its last leaf twice.
export const buildTree = (
	leafHashes: Buffer[],
	index?: number,
): { root: Buffer; auditPath: AuditPathNode[] } => {
	if (leafHashes.length === 0) {
		throw new Error('Cannot build Merkle root from empty list');
	}

	const auditPath: AuditPathNode[] = [];
	let level = leafHashes;
	let currentIndex = index;

	while (level.length > 1) {
		if (currentIndex !== undefined) {
			const isLeftChild = currentIndex % 2 === 0;
			const sibling = level[isLeftChild ? currentIndex + 1 : currentIndex - 1];

			if (sibling !== undefined) {
				auditPath.push({ hash: sibling, position: isLeftChild ? 'right' : 'left' });
			}
			currentIndex = Math.floor(currentIndex / 2);
		}

		const nextLevel: Buffer[] = [];
		for (let position = 0; position < level.length; position += 2) {
			const left = level[position];
			const right = level[position + 1];
			if (left === undefined) {
				throw new Error('Unexpected undefined hash while building Merkle tree');
			}

			nextLevel.push(right === undefined ? left : hashNode(left, right));
		}

		level = nextLevel;
	}

	const [root] = level;
	if (root === undefined) {
		throw new Error('Failed to compute Merkle root');
	}

	return { root, auditPath };
};

export const calculateRootFromAuditPath = (leafHash: Buffer, auditPath: AuditPathNode[]): Buffer =>
	auditPath.reduce(
		(hash, sibling) =>
			sibling.position === 'left' ? hashNode(sibling.hash, hash) : hashNode(hash, sibling.hash),
		leafHash,
	);
