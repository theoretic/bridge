/**
 * ProcessBridgeDemo: the Process's own component module, imported by the runtime because the
 * Process implements BridgeComponent with a `module` key. Marks the page once it has run so
 * the conformance checks can see that Process modules get imported too.
 */
document.body.setAttribute('data-bridge-process', 'pw-bridge-demo');

export default { tag: 'pw-bridge-demo', version: '1' };
