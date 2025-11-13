import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { BackupEntry } from './types.js';

export const readBackupFile = async (filePath: string): Promise<BackupEntry[]> => {
	// Check if file exists and is readable
	try {
		await access(filePath);
	} catch {
		throw new Error(`File not found: ${filePath}`);
	}

	const entries: BackupEntry[] = [];
	const fileStream = createReadStream(filePath);
	const rl = createInterface({
		input: fileStream,
		crlfDelay: Number.POSITIVE_INFINITY,
	});

	for await (const line of rl) {
		if (line.trim() === '') {
			continue;
		}

		try {
			const entry = JSON.parse(line) as BackupEntry;

			// Extract the original data JSON string to preserve Unicode escapes.
			// We manually parse the data field to handle nested objects and
			// escaped characters correctly.
			if (line.includes('"data":')) {
				const dataStart = line.indexOf('"data":') + 7;
				let braceCount = 0;
				let dataEnd = dataStart;
				let foundStart = false;

				for (let i = dataStart; i < line.length; i++) {
					if (line[i] === '{' && !foundStart) {
						foundStart = true;
						braceCount = 1;
						dataEnd = i + 1;
						continue;
					}

					if (foundStart) {
						if (line[i] === '\\') {
							i++; // Skip escaped characters
							dataEnd = i + 1;
							continue;
						}
						if (line[i] === '{') braceCount++;
						if (line[i] === '}') {
							braceCount--;
							if (braceCount === 0) {
								dataEnd = i + 1;
								break;
							}
						}
						dataEnd = i + 1;
					}
				}

				const startPos = dataStart + line.substring(dataStart).indexOf('{');
				entry.payload.originalDataString = line.substring(startPos, dataEnd);
			}

			entries.push(entry);
		} catch (error) {
			throw new Error(
				`Failed to parse JSON line: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return entries;
};

export const findEventById = (entries: BackupEntry[], eventId: string): BackupEntry | undefined => {
	return entries.find(entry => entry.payload.event.id === eventId);
};
