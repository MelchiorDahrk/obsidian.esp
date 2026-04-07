/**
 * Common interface for reporting progress of long-running operations.
 * Allows decoupling business logic from specific UI components like ProgressBars.
 */
export interface ProgressReporter {
	/**
	 * Updates the progress state.
	 * @param percent Progress percentage (0-100).
	 * @param message Current status message.
	 */
	update(percent: number, message: string): void;

	/**
	 * Sets a new title for the progress operation.
	 */
	setTitle?(title: string): void;
}

/**
 * A ProgressReporter that does nothing. Useful for silent operations.
 */
export const NullReporter: ProgressReporter = {
	update: () => {},
	setTitle: () => {},
};
