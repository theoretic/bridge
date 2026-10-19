/**
 * <pw-text>: reference Bridge component element for InputfieldBridgeText.
 *
 * ES module, auto-imported by the Bridge runtime because the Inputfield wrapper carries
 * data-bridge-module (see docs/contract.md). Registers itself on import. Wraps the upstream
 * <input> (unchanged id/name), shows a live character counter, trims on blur, and dispatches a
 * bubbling `change` when it changes the value itself so dependencies re-evaluate.
 */

class PwText extends HTMLElement {

	connectedCallback() {
		if(this.counter) return;
		const input = this.input();
		if(!input) return;
		this.counter = document.createElement('small');
		this.counter.className = 'pw-text-counter notes';
		this.appendChild(this.counter);
		this.update();
		input.addEventListener('input', () => this.update());
		input.addEventListener('blur', () => {
			const trimmed = input.value.trim();
			if(trimmed === input.value) return;
			input.value = trimmed;
			input.dispatchEvent(new Event('change', { bubbles: true }));
			this.update();
		});
	}

	input() {
		return this.querySelector('input, textarea');
	}

	update() {
		const input = this.input();
		if(!input || !this.counter) return;
		const max = parseInt(this.getAttribute('maxlength') || '0', 10);
		this.counter.textContent = max > 0 ? `${input.value.length} / ${max}` : `${input.value.length}`;
	}
}

if(!customElements.get('pw-text')) customElements.define('pw-text', PwText);

export default { tag: 'pw-text', version: '1' };
