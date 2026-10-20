/**
 * A warning in the theme's notice band from the client side (component import failures, audit B24);
 * a chunk of its own, loaded only when there is something to say.
 */

const noticed = new Set<string>();
export function notice(text: string): void {
	if (noticed.has(text) || !document.body) return;
	noticed.add(text);
	// the markup core's AdminThemeFramework::renderNotices() prints (in the theme's place for it)
	let list = document.querySelector<HTMLElement>('#notices');
	if (!list) {
		list = document.createElement('ul');
		list.id = 'notices';
		list.className = 'pw-notices';
		const masthead = document.getElementById('pw-masthead');
		if (masthead) masthead.after(list);
		else document.body.prepend(list);
	}
	const li = document.createElement('li');
	li.className = 'NoticeWarning pw-notice-warning';
	const icon = document.createElement('i');
	icon.className = 'fa fa-fw fa-exclamation-circle';
	li.append(icon, ' ', text);
	list.appendChild(li);
}
