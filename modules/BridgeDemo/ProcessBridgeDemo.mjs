/**
 * ProcessBridgeDemo: the Process's own component module, imported by the runtime because the
 * Process implements BridgeComponent with a `module` key. Marks the page once it has run so
 * the conformance checks can see that Process modules get imported too. Since 0.3.0 it is also
 * the module of the Process's extension manifest, so the runtime imports it on every admin page
 * for users who may edit pages (docs/extensions.md 7), and the mark is on those pages as well.
 */
document.body.setAttribute('data-bridge-process', 'pw-bridge-demo');

export default { tag: 'pw-bridge-demo', version: '1' };
