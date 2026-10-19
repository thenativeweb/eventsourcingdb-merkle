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
import { buildVersion3Tree, calculateVersion3Root } from './merkleTreeVersion3.js';
import { deriveSalt } from './saltKey.js';
import type { MerkleProof, MerkleProofVersion3, MerkleProofWithSides } from './types.js';

// A root that names the version of its tree starts with this prefix. A root
// without it is of version 1, which predates the prefix.
const merkleRootPrefix = 'esdb:merkle:';
const merkleRootVersion2Prefix = `${merkleRootPrefix}v2:`;
const merkleRootVersion3Prefix = `${merkleRootPrefix}v3:`;

// A salt and the hash of a node are SHA-256 digests, which a proof carries in
// hexadecimal. Decoding takes text that is not exactly that only as far as it
// can, so a proof that holds more than the digest would still verify.
const digestPattern = /^[0-9a-f]{64}$/iu;

export type MerkleTreeVersion = 1 | 2 | 3;

// Only the trees of versions 2 and 3 salt their leaves, and only where a key is
// given.
export type MerkleTreeOptions = { treeVersion: 1 } | { treeVersion: 2 | 3; saltKey?: Buffer };

export class UnsupportedMerkleTreeVersionError extends Error {
	public constructor(version: string) {
		super(`Unsupported Merkle tree version: ${version}`);
		this.name = 'UnsupportedMerkleTreeVersionError';
	}
}

// The data of a leaf of versions 2 and 3 is the stored hash of its event, as
// text, which covers both versions of the hash alike, preceded by its salt where
// the leaves are salted.
const getLeafHash = (storedHash: string, salt: Buffer | undefined): Buffer =>
	hashLeaf(Buffer.concat([salt ?? Buffer.alloc(0), Buffer.from(storedHash, 'utf-8')]));

const getSalt = (saltKey: Buffer | undefined, storedHash: string): Buffer | undefined =>
	saltKey === undefined ? undefined : deriveSalt(saltKey, storedHash);

const getLeafHashes = (hashes: string[], saltKey: Buffer | undefined): Buffer[] =>
	hashes.map(hash => getLeafHash(hash, getSalt(saltKey, hash)));

const formatVersion2Root = (root: Buffer): string =>
	`${merkleRootVersion2Prefix}${root.toString('hex')}`;

const formatVersion3Root = (root: Buffer): string =>
	`${merkleRootVersion3Prefix}${root.toString('hex')}`;

export const calculateMerkleRoot = (hashes: string[], options: MerkleTreeOptions): string => {
	if (options.treeVersion === 1) {
		return buildVersion1Root(hashes);
	}

	const leafHashes = getLeafHashes(hashes, options.saltKey);
	if (options.treeVersion === 2) {
		return formatVersion2Root(buildTree(leafHashes).root);
	}

	return formatVersion3Root(buildVersion3Tree(leafHashes).root);
};

// A proof as the tree gives it, without the ID of its event, which the tree
// does not know in versions 1 and 2.
export type TreeProof =
	| Omit<MerkleProofWithSides, 'eventId'>
	| Omit<MerkleProofVersion3, 'eventId'>;

export const generateMerkleProof = (
	hashes: string[],
	index: number,
	options: MerkleTreeOptions,
): TreeProof => {
	const eventHash = hashes[index];
	if (eventHash === undefined) {
		throw new Error('Target hash not found in the list');
	}

	if (options.treeVersion === 1) {
		return generateVersion1Proof(hashes, eventHash);
	}

	const salt = getSalt(options.saltKey, eventHash);
	const leaf = {
		eventHash,
		...(salt === undefined ? {} : { salt: salt.toString('hex') }),
	};
	const leafHashes = getLeafHashes(hashes, options.saltKey);

	if (options.treeVersion === 2) {
		const { root, auditPath } = buildTree(leafHashes, index);

		return {
			...leaf,
			siblingHashes: auditPath.map(({ hash, position }) => ({
				hash: hash.toString('hex'),
				position,
			})),
			merkleRoot: formatVersion2Root(root),
		};
	}

	// The leaf at an index of the tree of version 3 is the event with that ID, so
	// the last event of the tree has the ID one below the number of its leaves.
	const { root, auditPath } = buildVersion3Tree(leafHashes, index);

	return {
		...leaf,
		siblingHashes: auditPath.map(hash => hash.toString('hex')),
		merkleRoot: formatVersion3Root(root),
		lastEventId: String(hashes.length - 1),
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
	if (merkleRoot.startsWith(merkleRootVersion3Prefix)) {
		return 3;
	}

	const [version = ''] = merkleRoot.slice(merkleRootPrefix.length).split(':');
	throw new UnsupportedMerkleTreeVersionError(version);
};

const isDigest = (value: unknown): boolean =>
	typeof value === 'string' && digestPattern.test(value);

const isText = (value: unknown): boolean => typeof value === 'string';

// A sibling of version 1 or 2 is an object with its hash and its side. The hash
// of a sibling of version 2 is a digest, but that of version 1 has no fixed
// form, since the tree of version 1 takes any stored hash as a leaf, so the
// first sibling of a proof may be the stored hash of a neighbor.
const isSiblingWithSide =
	(isHash: (value: unknown) => boolean) =>
	(sibling: unknown): boolean =>
		isObject(sibling) &&
		isHash(sibling.hash) &&
		(sibling.position === 'left' || sibling.position === 'right');

// An ID in a proof of version 3 is written as EventSourcingDB writes IDs, since
// get-proof writes it rather than anyone typing it, so that the same proof has
// one notation only.
const eventIdPattern = /^(0|[1-9][0-9]*)$/u;

const isEventId = (value: unknown): boolean =>
	typeof value === 'string' && eventIdPattern.test(value);

// findProofStructureProblem describes what keeps a proof from being one that
// can be verified, or returns undefined if nothing does. Which fields a proof may
// or has to have depends on the version of its tree alone, so they are part of
// the structure, as is the form of every field. The form of the event hash in
// versions 2 and 3 matters for another reason: the data of a leaf is its salt
// followed by the stored hash, with nothing between them that tells where the
// salt ends, so without that form, a proof whose salt took the first bytes of
// the hash would pass for a proof of the rest of it. With it, the data of a leaf
// has other lengths with a salt than without one. Whether the fields fit one
// another, such as an event ID beyond the last one, is left to the verification,
// as RFC 9162 leaves it.
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

	const treeVersion = getMerkleTreeVersion(proof.merkleRoot);
	const hasSalt = proof.salt !== undefined;
	const hasLastEventId = proof.lastEventId !== undefined;

	if (treeVersion === 1) {
		if (hasSalt) {
			return 'A proof of Merkle tree version 1 has no salt';
		}
		if (hasLastEventId) {
			return 'A proof of Merkle tree version 1 has no last event ID';
		}
		if (!proof.siblingHashes.every(isSiblingWithSide(isText))) {
			return 'Every sibling has to have a hash, and the position left or right';
		}

		return undefined;
	}

	if (treeVersion === 2 && hasLastEventId) {
		return 'A proof of Merkle tree version 2 has no last event ID';
	}
	if (treeVersion === 3) {
		if (proof.eventId === undefined || !hasLastEventId) {
			return 'A proof of Merkle tree version 3 has to contain eventId and lastEventId';
		}
		if (!isEventId(proof.eventId)) {
			return 'The event ID has to be digits alone, without a sign or leading zeros';
		}
	}

	if (!isKnownStoredHash(proof.eventHash)) {
		return 'The event hash has to be a hash of version 1 or 2';
	}
	if (hasSalt && !isDigest(proof.salt)) {
		return 'The salt has to be 64 hexadecimal digits';
	}

	if (treeVersion === 2) {
		return proof.siblingHashes.every(isSiblingWithSide(isDigest))
			? undefined
			: 'Every sibling has to have a hash of 64 hexadecimal digits, and the position left or right';
	}

	if (!proof.siblingHashes.every(isDigest)) {
		return 'Every sibling has to be a hash of 64 hexadecimal digits';
	}
	if (!isEventId(proof.lastEventId)) {
		return 'The last event ID has to be digits alone, without a sign or leading zeros';
	}

	return undefined;
};

// verifyMerkleProof tells whether a proof leads from the hash of its event to
// its root, in the version of the tree that the root names, and in version 3,
// whether it does so from the leaf of its event in a tree that ends at its last
// event. A proof in which findProofStructureProblem finds a problem proves
// nothing, and one that passes it has the fields of its version.
export const verifyMerkleProof = (proof: MerkleProof): boolean => {
	if (findProofStructureProblem(proof) !== undefined) {
		return false;
	}

	const treeVersion = getMerkleTreeVersion(proof.merkleRoot);
	if (treeVersion === 1) {
		return verifyVersion1Proof(proof as MerkleProofWithSides);
	}

	const salt = proof.salt === undefined ? undefined : Buffer.from(proof.salt, 'hex');
	const leafHash = getLeafHash(proof.eventHash, salt);

	if (treeVersion === 2) {
		const auditPath: AuditPathNode[] = (proof as MerkleProofWithSides).siblingHashes.map(
			({ hash, position }) => ({ hash: Buffer.from(hash, 'hex'), position }),
		);

		return formatVersion2Root(calculateRootFromAuditPath(leafHash, auditPath)) === proof.merkleRoot;
	}

	const { eventId, lastEventId, siblingHashes } = proof as MerkleProofVersion3;
	const root = calculateVersion3Root(
		leafHash,
		BigInt(eventId),
		BigInt(lastEventId) + 1n,
		siblingHashes.map(hash => Buffer.from(hash, 'hex')),
	);

	return root !== undefined && formatVersion3Root(root) === proof.merkleRoot;
};
