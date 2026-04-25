import pc from "picocolors";

/** Print a key-value pair on one line. */
export function kv(label: string, value: string | number | boolean | null | undefined): void {
	const display = value === null || value === undefined ? pc.dim("—") : String(value);
	process.stdout.write(`  ${pc.bold(label.padEnd(18))} ${display}\n`);
}

/** Print a section header. */
export function header(text: string): void {
	process.stdout.write(`\n${pc.bold(pc.cyan(text))}\n`);
}

/** Print a simple table from rows of objects. */
export function table(
	rows: Record<string, string | number | boolean | null | undefined>[],
	columns: { key: string; label: string; width?: number }[],
): void {
	if (rows.length === 0) {
		process.stdout.write(pc.dim("  (empty)\n"));
		return;
	}

	// Header row
	const headerLine = columns
		.map((col) => pc.bold(col.label.padEnd(col.width ?? 20)))
		.join("  ");
	process.stdout.write(`  ${headerLine}\n`);

	// Separator
	const sep = columns.map((col) => "─".repeat(col.width ?? 20)).join("──");
	process.stdout.write(`  ${pc.dim(sep)}\n`);

	// Data rows
	for (const row of rows) {
		const line = columns
			.map((col) => {
				const val = row[col.key];
				const str = val === null || val === undefined ? "—" : String(val);
				return str.padEnd(col.width ?? 20);
			})
			.join("  ");
		process.stdout.write(`  ${line}\n`);
	}
}

/** Print a success message. */
export function success(text: string): void {
	process.stdout.write(`${pc.green("✓")} ${text}\n`);
}

/** Print a warning message. */
export function warn(text: string): void {
	process.stderr.write(`${pc.yellow("!")} ${text}\n`);
}

/** Print an error message. */
export function error(text: string): void {
	process.stderr.write(`${pc.red("✗")} ${text}\n`);
}
