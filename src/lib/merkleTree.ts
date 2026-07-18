import { hashPair } from './hash.js';
import type { MerkleProof } from './types.js';

export const buildMerkleRoot = (hashes: string[]): string => {
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

export const generateMerkleProof = (
	hashes: string[],
	targetHash: string,
): Omit<MerkleProof, 'eventId'> => {
	const targetIndex = hashes.indexOf(targetHash);

	if (targetIndex === -1) {
		throw new Error('Target hash not found in the list');
	}

	const siblingHashes: Array<{ hash: string; position: 'left' | 'right' }> = [];
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
					// Target is on the left
					if (i + 1 < currentLevel.length) {
						siblingHashes.push({ hash: right, position: 'right' });
					}
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

export const verifyMerkleProof = (proof: Omit<MerkleProof, 'eventId'>): boolean => {
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
