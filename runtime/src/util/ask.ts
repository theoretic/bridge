/**
 * A confirmation dialog in place of window.confirm() (0.15.0, ADR 0019): a native
 * <dialog class="pw-ask"> with a title, what is at stake, an optional list of names, Cancel and OK.
 * A risky action's dialog (danger) has the warning icon and a red OK button carrying the action's
 * verb. Cancel has focus first; Esc and a click on the backdrop cancel. Resolves true for OK.
 */

import { label } from './labels';
import { esc } from './html';

export type AskOptions = {
	title: string;
	message?: string;
	items?: string[];
	ok?: string;
	danger?: boolean;
};

export function ask(opts: AskOptions): Promise<boolean> {
	return new Promise(resolve => {
		const d = document.createElement('dialog');
		d.className = 'pw-ask' + (opts.danger ? ' pw-ask-danger' : '');
		d.setAttribute('role', 'alertdialog');
		d.innerHTML = '<form method="dialog">' +
			`<p class="pw-ask-message">${opts.danger ? "<i class='fa fa-warning' aria-hidden='true'></i> " : ''}${esc(opts.title)}</p>` +
			(opts.message ? `<p class="pw-ask-risk">${esc(opts.message)}</p>` : '') +
			(opts.items && opts.items.length ? '<ul class="pw-ask-items">' + opts.items.map(s => `<li>${esc(s)}</li>`).join('') + '</ul>' : '') +
			'<div class="pw-ask-buttons">' +
			`<button type="submit" value="ok" class="ui-button pw-button${opts.danger ? ' pw-button-danger' : ''}">${esc(opts.ok || label('ok', 'OK'))}</button>` +
			`<button type="submit" value="cancel" class="ui-button pw-button ui-priority-secondary">${esc(label('cancel', 'Cancel'))}</button></div></form>`;
		const title = d.querySelector('.pw-ask-message') as HTMLElement;
		title.id = 'pw-ask-' + Date.now();
		d.setAttribute('aria-labelledby', title.id);
		document.body.appendChild(d);
		// answered on the button's submit, Esc's cancel or the backdrop, not on 'close' alone: a
		// page that is not being rendered (a background tab) gets that event late
		let done = false;
		const finish = (ok: boolean): void => {
			if (done) return;
			done = true;
			if (d.open) d.close();
			d.remove();
			resolve(ok);
		};
		d.addEventListener('submit', e => {
			e.preventDefault();
			finish(!!e.submitter && (e.submitter as HTMLButtonElement).value === 'ok');
		});
		d.addEventListener('cancel', e => { e.preventDefault(); finish(false); });
		d.addEventListener('close', () => finish(d.returnValue === 'ok'));
		// the backdrop: a click on the dialog element outside its box (its padding is inside)
		d.addEventListener('click', e => {
			const r = d.getBoundingClientRect();
			if (e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) finish(false);
		});
		d.showModal();
		(d.querySelector('button[value="cancel"]') as HTMLButtonElement).focus();
	});
}
