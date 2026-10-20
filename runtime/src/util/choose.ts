/**
 * A small modal choice (milestone 3.3): stands in for upstream's vex.dialog.open() with a select,
 * as the repeater's copy / clone / paste menu uses it. A native <dialog class="pw-ask"> with the
 * message, a select of the options, an optional note, OK and Cancel. Resolves with the chosen
 * value, or null when cancelled.
 */

import { label } from './labels';

export type Choice = { value: string; label: string; disabled?: boolean; selected?: boolean };

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function choose(message: string, choices: Choice[], noteHtml = ''): Promise<string | null> {
	return new Promise(resolve => {
		const d = document.createElement('dialog');
		d.className = 'pw-ask';
		d.innerHTML = `<form method="dialog"><p class="pw-ask-message">${esc(message)}</p>` +
			'<select name="action" class="pw-select">' +
			choices.map(c => `<option value="${esc(c.value)}"${c.disabled ? ' disabled' : ''}${c.selected ? ' selected' : ''}>${esc(c.label)}</option>`).join('') +
			'</select>' + (noteHtml ? `<div class="pw-ask-note detail">${noteHtml}</div>` : '') +
			`<div class="pw-ask-buttons"><button type="submit" value="ok" class="ui-button pw-button">${esc(label('ok', 'OK'))}</button>` +
			`<button type="submit" value="cancel" class="ui-button pw-button ui-priority-secondary">${esc(label('cancel', 'Cancel'))}</button></div></form>`;
		document.body.appendChild(d);
		d.addEventListener('close', () => {
			const select = d.querySelector('select') as HTMLSelectElement;
			resolve(d.returnValue === 'ok' ? select.value : null);
			d.remove();
		});
		d.showModal();
		(d.querySelector('select') as HTMLSelectElement).focus();
	});
}
