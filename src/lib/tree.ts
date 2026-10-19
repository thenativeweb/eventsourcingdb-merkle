import { Flags } from '@oclif/core';
import type { ChainEvent } from './chainEvent.js';
import { isKnownStoredHash } from './hash.js';
import type { MerkleTreeOptions } from './merkleTree.js';
import { readSaltKey } from './saltKey.js';

// The flags that name the tree a command calculates: its version, and the file
// with the key that salts its leaves. Version 2 is the default, and version 1
// stays for the roots that releases before 3.0 calculated. Only the commands
// that calculate a tree take them, since a proof names its version and carries
// its salt.
export const getTreeFlags = (treeVersionDescription: string) => ({
	'salt-key-file': Flags.string({
		description: 'File with the salt key to salt the leaves of the tree with',
	}),
	'tree-version': Flags.string({
		description: treeVersionDescription,
		options: ['1', '2'],
		default: '2',
	}),
});

export type Tree = { treeVersion: 1 } | { treeVersion: 2; saltKeyFile?: string };

// getTree returns the tree that the flags name, or why they name none: the tree
// of version 1 has no salts, so a salt key file for it would be ignored, which
// would leave a root unsalted that was meant to be salted.
export const getTree = (flags: {
	'salt-key-file'?: string;
	'tree-version': string;
}): Tree | { refusal: string } => {
	const saltKeyFile = flags['salt-key-file'];

	if (flags['tree-version'] === '1') {
		if (saltKeyFile !== undefined) {
			return { refusal: '--salt-key-file and --tree-version=1 cannot be used together' };
		}

		return { treeVersion: 1 };
	}

	return { treeVersion: 2, saltKeyFile };
};

// readTreeOptions reads the salt key of a tree, if it has one. A command reads it
// before its source, so that a key file that cannot be read stops it before it
// reads a large backup or database for nothing.
export const readTreeOptions = async (tree: Tree): Promise<MerkleTreeOptions> => {
	if (tree.treeVersion === 1 || tree.saltKeyFile === undefined) {
		return { treeVersion: tree.treeVersion };
	}

	return { treeVersion: 2, saltKey: await readSaltKey(tree.saltKeyFile) };
};

// getTreeHashes returns the stored hashes of the events, as the leaves of the
// tree. The tree of version 2 takes only hashes of a form it knows, since only
// they keep the data of a leaf unambiguous, which is why verify-proof refuses
// any other: a root over such a leaf would hold a leaf that no proof could
// prove. The tree of version 1 takes any hash, as it always did.
export const getTreeHashes = (events: ChainEvent[], treeOptions: MerkleTreeOptions): string[] => {
	if (treeOptions.treeVersion === 2) {
		const event = events.find(({ hash }) => !isKnownStoredHash(hash));
		if (event !== undefined) {
			throw new Error(`event ${event.id} has no hash of version 1 or 2`);
		}
	}

	return events.map(({ hash }) => hash);
};
