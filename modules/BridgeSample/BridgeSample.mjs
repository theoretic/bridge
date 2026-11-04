/**
 * BridgeSample: the extension's client module (docs/extensions.md 5), imported by the Bridge runtime
 * for users who may have the extension. Defines <pw-bridgesample>, the element its slot markup uses; guarded,
 * because Bridge.extensions.reload() imports the module again.
 *
 * MIT.
 */
const tag = 'pw-bridgesample';
const version = '0.1.0';

if (!customElements.get(tag)) {
	customElements.define(tag, class extends HTMLElement {
		connectedCallback() {
			this.setAttribute('data-ready', '');
		}
	});
}

// the runtime's contract events arrive on document; the extension's own are pw-bridgesample-<event>
document.addEventListener('pw-runtime-ready', () => {
	document.documentElement.setAttribute('data-bridgesample', version);
}, { once: true });
if (document.body && document.body.classList.contains('pw-runtime-ready')) document.documentElement.setAttribute('data-bridgesample', version);

export default { tag, version };
