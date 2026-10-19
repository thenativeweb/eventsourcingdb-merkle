import { isKnownStoredHash } from './hash.js';
import { isObject } from './isObject.js';
import {
	buildVersion1Root,
	generateVersion1Proof,
	verifyVersion1Proof,
} from './merkleTreeVersion1.js';
import {
	type AuditPathNode,
	buildTree,
	calculateRootFromAuditPath,
	hashLeaf,
} from './merkleTreeVersion2.js';
import { deriveSalt } from './saltKey.js';
import type { MerkleProof } from './types.js';

// A root that names the version of its tree starts with this prefix. A root
// without it is of version 1, which predates the prefix.
const merkleRootPrefix = 'esdb:merkle:';
const merkleRootVersion2Prefix = `${merkleRootPrefix}v2:`;

// A salt and the hash of a node are SHA-256 digests, which a proof carries in
// hexadecimal. Decoding takes text that is not exactly that only as far as it
// can, so a proof that holds more than the digest would still verify.
const digestPattern = /^[0-9a-f]{64}$/iu;

export type MerkleTreeVersion = 1 | 2;

// Only the tree of version 2 salts its leaves, and only where a key is given.
export type MerkleTreeOptions = { treeVersion: 1 } | { treeVersion: 2; saltKey?: Buffer };

export class UnsupportedMerkleTreeVersionError extends Error {
	public constructor(version: string) {
		super(`Unsupported Merkle tree version: ${version}`);
		this.name = 'UnsupportedMerkleTreeVersionError';
	}
}

// The data of a leaf of version 2 is the stored hash of its event, as text, which
// covers both versions of the hash alike, preceded by its salt where the leaves
// are salted.
const getLeafHash = (storedHash: string, salt: Buffer | undefined): Buffer =>
	hashLeaf(Buffer.concat([salt ?? Buffer.alloc(0), Buffer.from(storedHash, 'utf-8')]));

const getSalt = (saltKey: Buffer | undefined, storedHash: string): Buffer | undefined =>
	saltKey === undefined ? undefined : deriveSalt(saltKey, storedHash);

const getLeafHashes = (hashes: string[], saltKey: Buffer | undefined): Buffer[] =>
	hashes.map(hash => getLeafHash(hash, getSalt(saltKey, hash)));

const formatVersion2Root = (root: Buffer): string =>
	`${merkleRootVersion2Prefix}${root.toString('hex')}`;

export const calculateMerkleRoot = (hashes: string[], options: MerkleTreeOptions): string => {
	if (options.treeVersion === 1) {
		return buildVersion1Root(hashes);
	}

	return formatVersion2Root(buildTree(getLeafHashes(hashes, options.saltKey)).root);
};

export const generateMerkleProof = (
	hashes: string[],
	index: number,
	options: MerkleTreeOptions,
): Omit<MerkleProof, 'eventId'> => {
	const eventHash = hashes[index];
	if (eventHash === undefined) {
		throw new Error('Target hash not found in the list');
	}

	if (options.treeVersion === 1) {
		return generateVersion1Proof(hashes, eventHash);
	}

	const salt = getSalt(options.saltKey, eventHash);
	const { root, auditPath } = buildTree(getLeafHashes(hashes, options.saltKey), index);

	return {
		eventHash,
		...(salt === undefined ? {} : { salt: salt.toString('hex') }),
		siblingHashes: auditPath.map(({ hash, position }) => ({
			hash: hash.toString('hex'),
			position,
		})),
		merkleRoot: formatVersion2Root(root),
	};
};

// getMerkleTreeVersion tells the version of the tree that a root names, the way
// the version of a hash is told: a root without the prefix is of version 1, and
// every other root with it of a version that the tool does not know.
export const getMerkleTreeVersion = (merkleRoot: string): MerkleTreeVersion => {
	if (!merkleRoot.startsWith(merkleRootPrefix)) {
		return 1;
	}
	if (merkleRoot.startsWith(merkleRootVersion2Prefix)) {
		return 2;
	}

	const [version = ''] = merkleRoot.slice(merkleRootPrefix.length).split(':');
	throw new UnsupportedMerkleTreeVersionError(version);
};

const isSibling = (sibling: unknown): boolean =>
	isObject(sibling) &&
	typeof sibling.hash === 'string' &&
	digestPattern.test(sibling.hash) &&
	(sibling.position === 'left' || sibling.position === 'right');

// findProofStructureProblem describes what keeps a proof from being one that
// can be verified, or returns undefined if nothing does. A salt is part of the
// structure, since whether a proof may have one depends on the version of its
// tree alone. So is the form of the event hash in version 2: the data of a leaf
// is its salt followed by the stored hash, with nothing between them that tells
// where the salt ends, so without that form, a proof whose salt took the first
// bytes of the hash would pass for a proof of the rest of it. With it, the data
// of a leaf has other lengths with a salt than without one.
export const findProofStructureProblem = (proof: unknown): string | undefined => {
	if (
		!isObject(proof) ||
		typeof proof.eventHash !== 'string' ||
		proof.eventHash === '' ||
		typeof proof.merkleRoot !== 'string' ||
		proof.merkleRoot === '' ||
		!Array.isArray(proof.siblingHashes)
	) {
		return 'Must contain eventHash, merkleRoot, and siblingHashes';
	}

	const hasSalt = proof.salt !== undefined;
	if (getMerkleTreeVersion(proof.merkleRoot) === 1) {
		return hasSalt ? 'A proof of Merkle tree version 1 has no salt' : undefined;
	}
	if (!isKnownStoredHash(proof.eventHash)) {
		return 'The event hash has to be a hash of version 1 or 2';
	}
	if (hasSalt && (typeof proof.salt !== 'string' || !digestPattern.test(proof.salt))) {
		return 'The salt has to be 64 hexadecimal digits';
	}
	if (!proof.siblingHashes.every(isSibling)) {
		return 'Every sibling has to have a hash of 64 hexadecimal digits, and the position left or right';
	}

	return undefined;
};

// verifyMerkleProof tells whether a proof leads from the hash of its event to
// its root, in the version of the tree that the root names. A proof in which
// findProofStructureProblem finds a problem proves nothing.
export const verifyMerkleProof = (proof: Omit<MerkleProof, 'eventId'>): boolean => {
	if (findProofStructureProblem(proof) !== undefined) {
		return false;
	}
	if (getMerkleTreeVersion(proof.merkleRoot) === 1) {
		return verifyVersion1Proof(proof);
	}

	const auditPath: AuditPathNode[] = proof.siblingHashes.map(({ hash, position }) => ({
		hash: Buffer.from(hash, 'hex'),
		position,
	}));
	const salt = proof.salt === undefined ? undefined : Buffer.from(proof.salt, 'hex');
	const root = calculateRootFromAuditPath(getLeafHash(proof.eventHash, salt), auditPath);

	return formatVersion2Root(root) === proof.merkleRoot;
};
