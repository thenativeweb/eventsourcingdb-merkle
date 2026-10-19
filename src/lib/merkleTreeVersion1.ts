import { hashPair } from './hash.js';
import type { MerkleProofWithSides, SiblingWithSide } from './types.js';

// The Merkle tree of version 1, which releases before 3.0 calculated. It hashes
// leaves and inner nodes alike, and pairs a node that is left without a partner
// with itself, so that a list of hashes has the same root as the same list with
// its last hash twice. It stays only to calculate the roots that were published
// with it again, and to verify their proofs.

export const buildVersion1Root = (hashes: string[]): string => {
	if (hashes.length === 0) {
		throw new Error('Cannot build Merkle root from empty list');
	}

	let currentLevel = [...hashes];

	while (currentLevel.length > 1) {
		const nextLevel: string[] = [];

		for (let i = 0; i < currentLevel.length; i += 2) {
			const left = currentLevel[i];
			const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : currentLevel[i];

			if (left === undefined || right === undefined) {
				throw new Error('Unexpected undefined hash while building Merkle tree');
			}

			nextLevel.push(hashPair(left, right));
		}

		currentLevel = nextLevel;
	}

	const [root] = currentLevel;
	if (root === undefined) {
		throw new Error('Failed to compute Merkle root');
	}

	return root;
};

export const generateVersion1Proof = (
	hashes: string[],
	targetHash: string,
): Omit<MerkleProofWithSides, 'eventId'> => {
	const targetIndex = hashes.indexOf(targetHash);

	if (targetIndex === -1) {
		throw new Error('Target hash not found in the list');
	}

	const siblingHashes: SiblingWithSide[] = [];
	let currentLevel = [...hashes];
	let currentIndex = targetIndex;

	while (currentLevel.length > 1) {
		const nextLevel: string[] = [];
		let nextIndex = 0;

		for (let i = 0; i < currentLevel.length; i += 2) {
			const left = currentLevel[i];
			const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : currentLevel[i];

			if (left === undefined || right === undefined) {
				throw new Error('Unexpected undefined hash while generating Merkle proof');
			}

			if (i === currentIndex || i + 1 === currentIndex) {
				if (currentIndex % 2 === 0) {
					// Target is on the left. Where it has no partner, the tree pairs it
					// with itself, so that it is its own sibling on the right.
					siblingHashes.push({ hash: right, position: 'right' });
				} else {
					// Target is on the right
					siblingHashes.push({ hash: left, position: 'left' });
				}
				nextIndex = Math.floor(currentIndex / 2);
			}

			nextLevel.push(hashPair(left, right));
		}

		currentLevel = nextLevel;
		currentIndex = nextIndex;
	}

	const [merkleRoot] = currentLevel;
	if (merkleRoot === undefined) {
		throw new Error('Failed to compute Merkle root');
	}

	return {
		eventHash: targetHash,
		siblingHashes,
		merkleRoot,
	};
};

export const verifyVersion1Proof = (proof: Omit<MerkleProofWithSides, 'eventId'>): boolean => {
	let currentHash = proof.eventHash;

	for (const { hash, position } of proof.siblingHashes) {
		if (position === 'left') {
			currentHash = hashPair(hash, currentHash);
		} else {
			currentHash = hashPair(currentHash, hash);
		}
	}

	return currentHash === proof.merkleRoot;
};
