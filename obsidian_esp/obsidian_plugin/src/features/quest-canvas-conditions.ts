export function speakerConditionValuesAreCompatible(
	label: string,
	sourceValue: string,
	candidateValue: string,
): boolean {
	if (label === 'Disposition') {
		const sourceDisposition = parseIntegerValue(sourceValue);
		const candidateDisposition = parseIntegerValue(candidateValue);
		if (sourceDisposition !== null && candidateDisposition !== null) {
			return sourceDisposition >= candidateDisposition;
		}
	}

	return sourceValue.toLowerCase() === candidateValue.toLowerCase();
}

function parseIntegerValue(value: string): number | null {
	const trimmedValue = value.trim();
	if (!/^-?\d+$/.test(trimmedValue)) {
		return null;
	}

	return Number.parseInt(trimmedValue, 10);
}
