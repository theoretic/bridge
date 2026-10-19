/**
 * Column widths on upstream markup, without jQuery.
 *
 * The server writes `style="width: N%"` on li.Inputfield.InputfieldColumnWidth and marks the
 * first column of each row with InputfieldColumnWidthFirst. The theme lays .Inputfields out as a
 * wrapping flex row, so equal heights come from align-items: stretch and rows break where the
 * server intended. The only thing left to do in script is what upstream does when a column is
 * hidden by showIf: give its width to the visible columns of the same row, and restore it when
 * it shows again.
 */

function columns(container: HTMLElement): HTMLElement[][] {
	const rows: HTMLElement[][] = [];
	let row: HTMLElement[] = [];
	for (const child of Array.from(container.children) as HTMLElement[]) {
		if (!child.classList.contains('Inputfield')) continue;
		const isColumn = child.classList.contains('InputfieldColumnWidth');
		if (!isColumn || child.classList.contains('InputfieldColumnWidthFirst')) {
			if (row.length) rows.push(row);
			row = [];
		}
		if (isColumn) row.push(child);
	}
	if (row.length) rows.push(row);
	return rows;
}

function originalWidth(li: HTMLElement): number {
	const stored = li.getAttribute('data-original-width');
	if (stored) return parseInt(stored, 10);
	const m = (li.getAttribute('style') || '').match(/width:\s*(\d+)/i);
	const pct = m ? parseInt(m[1], 10) : 100;
	li.setAttribute('data-original-width', String(pct));
	return pct;
}

export function recalcColumns(root: ParentNode): void {
	root.querySelectorAll<HTMLElement>('.Inputfields').forEach(container => {
		for (const row of columns(container)) {
			const visible = row.filter(li => !li.classList.contains('InputfieldStateHidden'));
			const total = row.reduce((sum, li) => sum + originalWidth(li), 0);
			const visibleTotal = visible.reduce((sum, li) => sum + originalWidth(li), 0);
			if (!visible.length || !visibleTotal) continue;
			const factor = visible.length === row.length ? 1 : total / visibleTotal;
			for (const li of visible) {
				const w = Math.min(100, Math.round(originalWidth(li) * factor));
				li.style.width = `${w}%`;
			}
		}
	});
}
