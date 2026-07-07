/**
 * @file Minimal pure-JS reader for the TES3 header record.
 *
 * Used to discover a plugin's master list *before* deciding how to load it,
 * without paying the cost of copying the whole file into WASM memory. Only
 * the leading `TES3` record is parsed; the rest of the plugin is untouched.
 *
 * TES3 layout refresher: a record is `tag(4) size(u32) unknown(u32) flags(u32)`
 * followed by `size` bytes of subrecords, each `tag(4) size(u32) data`.
 * The header's subrecords are one `HEDR` followed by `MAST`/`DATA` pairs,
 * one pair per master file.
 */
const TES3_TAG = 'TES3';
const HEDR_TAG = 'HEDR';
const MAST_TAG = 'MAST';
const DATA_TAG = 'DATA';

/** Reads a 4-character ASCII subrecord/record tag. */
function readTag(bytes: Uint8Array, offset: number): string {
	if (offset + 4 > bytes.length) {
		throw new Error('Unexpected end of plugin header.');
	}

	return String.fromCharCode(
		bytes[offset] ?? 0,
		bytes[offset + 1] ?? 0,
		bytes[offset + 2] ?? 0,
		bytes[offset + 3] ?? 0,
	);
}

/** Reads a little-endian unsigned 32-bit integer. */
function readU32(bytes: Uint8Array, offset: number): number {
	if (offset + 4 > bytes.length) {
		throw new Error('Unexpected end of plugin header.');
	}

	const byte0 = bytes[offset] ?? 0;
	const byte1 = bytes[offset + 1] ?? 0;
	const byte2 = bytes[offset + 2] ?? 0;
	const byte3 = bytes[offset + 3] ?? 0;

	return (
		byte0 |
		(byte1 << 8) |
		(byte2 << 16) |
		(byte3 << 24)
	) >>> 0;
}

/** Decodes a NUL-padded byte string (master names are zero-terminated). */
function decodeString(bytes: Uint8Array): string {
	let end = bytes.length;
	while (end > 0 && bytes[end - 1] === 0) {
		end--;
	}

	return new TextDecoder().decode(bytes.subarray(0, end));
}

/**
 * Extracts the master-file names from a plugin's TES3 header record.
 *
 * Throws on any structural inconsistency (truncated record, unexpected
 * subrecord, missing `DATA` after a `MAST`) — callers treat a throw as
 * "no masters detectable" and fall back to a standalone load.
 */
export function extractMasterNamesFromPluginBytes(bytes: Uint8Array): string[] {
	if (bytes.length < 16) {
		throw new Error('Plugin is too small to contain a TES3 header.');
	}

	if (readTag(bytes, 0) !== TES3_TAG) {
		throw new Error('Plugin does not start with a TES3 header record.');
	}

	const recordSize = readU32(bytes, 4);
	const recordEnd = 12 + recordSize + 4;
	if (recordEnd > bytes.length) {
		throw new Error('Plugin header record is truncated.');
	}

	let offset = 16; // Skip record header and TES3 object flags.
	const masters: string[] = [];

	while (offset + 8 <= recordEnd) {
		const tag = readTag(bytes, offset);
		offset += 4;
		const size = readU32(bytes, offset);
		offset += 4;

		if (offset + size > recordEnd) {
			throw new Error(`Plugin header subrecord '${tag}' is truncated.`);
		}

		if (tag === HEDR_TAG) {
			offset += size;
			continue;
		}

		if (tag === MAST_TAG) {
			const masterName = decodeString(bytes.subarray(offset, offset + size));
			offset += size;

			if (offset + 8 > recordEnd || readTag(bytes, offset) !== DATA_TAG) {
				throw new Error(`Plugin header master '${masterName}' is missing DATA.`);
			}

			offset += 4;
			const dataSize = readU32(bytes, offset);
			offset += 4;
			if (offset + dataSize > recordEnd) {
				throw new Error(`Plugin header master '${masterName}' has truncated DATA.`);
			}

			masters.push(masterName);
			offset += dataSize;
			continue;
		}

		throw new Error(`Unexpected TES3 header subrecord '${tag}'.`);
	}

	return masters;
}
