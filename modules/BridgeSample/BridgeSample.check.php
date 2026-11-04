<?php namespace ProcessWire;

/**
 * BridgeSample: the extension's own checks, run by tools/extension-check.php after the contract tests.
 * Included with the sandbox booted: $wire, $module (the module, got with $modules->get()) and
 * check($label, $ok, $detail = '') are there. One line per declared slot; add your own.
 */

/** @var Wire $module */
check('BridgeSample: slot masthead-right returns its element', strpos((string) $module->slotMastheadRight('masthead-right'), "<pw-bridgesample data-slot='masthead-right'>") === 0);
check('BridgeSample: slot user-nav returns its element', strpos((string) $module->slotUserNav('user-nav'), "<pw-bridgesample data-slot='user-nav'>") === 0);
check('BridgeSample: slot content-head-buttons returns its element', strpos((string) $module->slotContentHeadButtons('content-head-buttons'), "<pw-bridgesample data-slot='content-head-buttons'>") === 0);
check('BridgeSample: slot footer returns its element', strpos((string) $module->slotFooter('footer'), "<pw-bridgesample data-slot='footer'>") === 0);
$out = $module->slotDrawer('drawer');
check('BridgeSample: slot drawer returns content, label and icon', is_array($out) && strpos((string) ($out['content'] ?? ''), '<pw-bridgesample') !== false && ($out['label'] ?? '') !== '' && ($out['icon'] ?? '') !== '');
check('BridgeSample: slot body returns its element', strpos((string) $module->slotBody('body'), "<pw-bridgesample data-slot='body'>") === 0);
