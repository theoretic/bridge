/**
 * ProcessBridgeDemo: fetch a legacy Inputfield over AJAX and drop it into the page.
 * Auto-loaded by the core because the basename equals the class name. No jQuery.
 */
document.addEventListener('click', function(e) {
	var button = e.target.closest('#BridgeDemoLoadLegacy');
	if(!button) return;
	e.preventDefault();
	var target = document.getElementById('BridgeDemoLegacy');
	button.disabled = true;
	fetch(button.getAttribute('data-url'), {
		credentials: 'same-origin',
		headers: { 'X-Requested-With': 'XMLHttpRequest' }
	}).then(function(r) {
		return r.text();
	}).then(function(html) {
		target.innerHTML = html;
		target.setAttribute('data-loaded', '1');
	}).catch(function(err) {
		target.textContent = String(err);
	});
});
