/**
 * Image lightbox (milestone 3.2): stands in for upstream's Magnific Popup (JqueryMagnific) where
 * the native image field opens a full-size image. A native <dialog class="pw-lightbox"> with the
 * image, its title, previous / next for a gallery (buttons, arrow keys) and a close button;
 * a click on the image closes it (Magnific's closeOnContentClick), Escape too.
 */

export type LightboxItem = { src: string; title?: string };

let dialog: HTMLDialogElement | null = null;

function build(): HTMLDialogElement {
	const d = document.createElement('dialog');
	d.className = 'pw-lightbox';
	d.innerHTML = '<figure class="pw-lightbox-figure"><img alt=""><figcaption></figcaption></figure>' +
		'<button type="button" class="pw-lightbox-prev" aria-label="Previous"><i class="fa fa-angle-left"></i></button>' +
		'<button type="button" class="pw-lightbox-next" aria-label="Next"><i class="fa fa-angle-right"></i></button>' +
		'<button type="button" class="pw-lightbox-close" aria-label="Close"><i class="fa fa-times"></i></button>';
	document.body.appendChild(d);
	d.addEventListener('click', e => {
		const t = e.target as HTMLElement;
		if (t === d || t.closest('.pw-lightbox-close') || t.tagName === 'IMG') d.close();
	});
	return d;
}

export function openLightbox(items: LightboxItem[], index = 0): void {
	if (!items.length) return;
	if (!dialog) dialog = build();
	const d = dialog;
	const img = d.querySelector('img') as HTMLImageElement;
	const caption = d.querySelector('figcaption') as HTMLElement;
	const prev = d.querySelector('.pw-lightbox-prev') as HTMLButtonElement;
	const next = d.querySelector('.pw-lightbox-next') as HTMLButtonElement;
	let n = Math.max(0, Math.min(index, items.length - 1));
	const show = (): void => {
		img.src = items[n].src;
		img.alt = items[n].title || '';
		caption.textContent = items[n].title || '';
		caption.style.display = items[n].title ? '' : 'none';
	};
	const step = (by: number): void => { n = (n + by + items.length) % items.length; show(); };
	prev.style.display = next.style.display = items.length > 1 ? '' : 'none';
	prev.onclick = () => step(-1);
	next.onclick = () => step(1);
	d.onkeydown = e => {
		if (items.length < 2) return;
		if (e.key === 'ArrowLeft') step(-1);
		else if (e.key === 'ArrowRight') step(1);
	};
	show();
	if (!d.open) d.showModal();
}

export function closeLightbox(): void {
	if (dialog && dialog.open) dialog.close();
}
