/**
 * The UIkit layer (ADR 0017): assets/dist/uikit.css, derived from core's stock uikit.css, and
 * assets/dist/uikit-covered.json, the uk-* classes the theme's own compat rules already style.
 *
 *   uikit.css          printed (or loaded) only on pages that need UIkit, with core's uikit.min.js
 *   uikit-covered.json read by the theme (a page using only these classes needs no layer) and
 *                      handed to the theme script for AJAX content
 *
 * From stock uikit.css the build keeps only selectors that name a UIkit class or attribute (bare
 * element selectors go; the Base component's are kept only for documents that load the admin's
 * stylesheets without being a page of this theme, such as a module's preview iframe), swaps UIkit's palette for the theme's
 * tokens outside the inverse rules, and wraps the result in `@layer uikit`, so every unlayered
 * stylesheet (theme, fields, modules) wins over it. Unlayered after it: heading classes that the
 * theme's element rules would otherwise beat, src/styles/uikit-layer.css (the theme's rules for the
 * layer), UIkit's inverse rules (they must beat the theme's compat rules inside .uk-light and the
 * coloured sections), and AdminThemeUikit's scheme classes (.dark-theme, .light-theme) as aliases
 * of data-pw-scheme, derived from 00-tokens.css.
 *
 * env: BRIDGE_WIRE  core's wire/ directory; without it uikit.css is not rebuilt (the committed file
 *                   stays). uikit-covered.json is always rebuilt (it comes from our own source).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import postcss from 'postcss';
import { transform } from 'esbuild';

const dist = fileURLToPath(new URL('../../modules/AdminThemeBridge/assets/dist/', import.meta.url));
const styles = fileURLToPath(new URL('../src/styles/', import.meta.url));

// 1. covered classes: every .uk-* class in 95-uikit-compat.css, plus the classes the theme itself
// puts on its markup (the language tabs: uk-tab, uk-active)
{
	const compat = readFileSync(join(styles, '95-uikit-compat.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
	const covered = new Set(['uk-tab', 'uk-active']);
	for (const m of compat.matchAll(/\.(uk-[\w-]+(?:\\@[a-z]+)?)/g)) covered.add(m[1].replace('\\@', '@'));
	writeFileSync(dist + 'uikit-covered.json', JSON.stringify([...covered].sort()) + '\n');
	console.log(`uikit-covered.json: ${covered.size} classes`);
}

const wire = process.env.BRIDGE_WIRE || '';
const source = wire ? join(wire, 'modules', 'AdminTheme', 'AdminThemeUikit', 'uikit', 'dist', 'css', 'uikit.css') : '';
if (!source || !existsSync(source)) {
	console.log("build-uikit: uikit.css skipped (set BRIDGE_WIRE to core's wire/ directory); committed file kept");
	process.exit(0);
}

const css = readFileSync(source, 'utf8');
const version = (css.match(/UIkit (\d+\.\d+\.\d+)/) || [])[1] || 'unknown';
const root = postcss.parse(css);

// 2. selectors: keep those that name UIkit
const isUikit = sel => /\.uk-|\[(?:data-)?uk-|\[class\*=['"]?uk-/.test(sel);
// the theme's language tabs carry uk-tab (init.php): UIkit's tab rules leave them alone
const rewrite = sel => sel.replace(/\.uk-tab(?![\w-])/g, '.uk-tab:not(.pw-lang-tabs)');

// :where(): the scope adds no specificity, so UIkit's component classes still win over its Base;
// html's rules go to body, where a preview sets AdminThemeUikit's scheme class (.dark-theme)
const FOREIGN = ':where(html.pw) > body:where(:not(.AdminThemeBridge))';
const foreign = sel => /^(html|body)\b/.test(sel) ? sel.replace(/^(html|body)/, FOREIGN)
	: `:where(html.pw > body:not(.AdminThemeBridge)) ${sel}`;

// 3. palette: UIkit's default colours -> tokens (outside the inverse rules)
const SURFACE_POPOVER = /uk-drop\b|uk-dropdown|uk-dropbar|uk-navbar-dropdown|uk-modal-dialog|uk-modal-header|uk-modal-footer|uk-notification-message|uk-tooltip/;
const SURFACE_CARD = /uk-card-default|uk-card-hover/;
const darker = token => `color-mix(in srgb, var(${token}) 85%, #000)`;
function mapColor(lit, prop, rule, decls) {
	const sel = rule.selector;
	const value = lit.toLowerCase();
	const bg = /^background/.test(prop);
	const border = /^(border|outline)/.test(prop);
	const alert = /uk-alert-(primary|success|warning|danger)/.exec(sel);
	switch (value) {
		case '#fff': case '#ffffff':
			if (bg) return SURFACE_CARD.test(sel) ? 'var(--card)' : SURFACE_POPOVER.test(sel) ? 'var(--popover)' : 'var(--background)';
			if (border) return 'var(--background)';
			// text on the primary colour: the theme's foreground for it (dark on cyan and green)
			if (prop === 'color' && decls.some(d => /^background/.test(d.prop) && /#1e87f0|#0f7ae5|#0e6dcd/i.test(d.value))) return 'var(--primary-foreground)';
			return null;
		case '#333': case '#222':
			return bg ? null : 'var(--foreground)';
		case '#666': return 'var(--uk-text)';
		case '#999': case '#999999': return 'var(--muted-foreground)';
		case '#1e87f0':
			if (alert && prop === 'color') return 'var(--primary)';
			return 'var(--primary)';
		case '#0f7ae5': case '#0e6dcd': case '#0f6ecd': case '#39f': return darker('--primary');
		case '#f8f8f8': return bg ? 'var(--muted)' : 'var(--border)';
		case '#f2f2f2': case '#ebebeb': case '#e6e6e6': return bg ? 'var(--accent)' : 'var(--border)';
		case '#e5e5e5': case '#dedede': case '#dfdfdf': return bg ? 'var(--muted)' : 'var(--border)';
		case '#f0506e':
			if (alert && prop === 'color') return 'var(--pw-status-error-fg)';
			return 'var(--destructive)';
		case '#ee395b': case '#ec2147': return darker('--destructive');
		case '#32d296':
			if (alert && prop === 'color') return 'var(--pw-status-success-fg)';
			return 'var(--success)';
		case '#faa05a':
			if (alert && prop === 'color') return 'var(--pw-status-warning-fg)';
			return 'var(--warning)';
		case '#d8eafc': return 'var(--pw-primary-bg)';
		case '#edfbf6': return 'var(--pw-status-success-bg)';
		case '#fff6ee': return 'var(--pw-status-warning-bg)';
		case '#fef4f6': return 'var(--pw-status-error-bg)';
	}
	return null;
}
const COLOR_PROPS = /^(color|background|background-color|border|border-(top|right|bottom|left)(-color)?|border-color|outline|outline-color|fill|stroke|caret-color|text-decoration-color|column-rule|column-rule-color|box-shadow)$/;

// the Inverse component (.uk-light, primary and secondary sections, tiles, cards) goes unlayered:
// it matches only inside those contexts, and there it must win over the theme's compat rules
// (95-uikit-compat.css paints .uk-button-primary on the primary colour, also on a primary section)
{
	let inverse = false;
	for (const n of root.nodes) {
		if (n.type === 'comment') {
			const m = /Component:\s*([\w ]+)/.exec(n.text);
			if (m) inverse = m[1].trim() === 'Inverse';
		} else if (inverse) n.raws.pwInverse = true;
	}
}

let component = '';
let kept = 0, dropped = 0, mapped = 0;
const headings = [];
root.walk(node => {
	if (node.type === 'comment') {
		const m = /Component:\s*([\w ]+)/.exec(node.text);
		if (m) component = m[1].trim();
		node.remove();
		return;
	}
	if (node.type !== 'rule') return;
	if (node.parent.type === 'atrule' && /keyframes$/.test(node.parent.name)) return;
	if (component === 'Print') { node.remove(); return; }
	// UIkit's JS reads its breakpoints and a few settings from custom properties on :root
	if (node.selector === ':root' && node.nodes.every(d => d.type === 'decl' && d.prop.startsWith('--uk-'))) { kept++; return; }
	const selectors = node.selectors.filter(isUikit).map(rewrite);
	// the Base component, for documents that load the admin's stylesheets without being admin
	// pages (a module's preview iframe): never on a page of this theme (body.AdminThemeBridge)
	if (component === 'Base') selectors.push(...node.selectors.filter(s => !isUikit(s)).map(foreign));
	if (!selectors.length) { node.remove(); dropped++; return; }
	node.selectors = selectors;
	kept++;
	for (const d of node.nodes) {
		if (d.type === 'decl' && d.prop === 'font-family' && /-apple-system/.test(d.value)) d.value = 'var(--pw-font)';
	}
	if (component !== 'Inverse') {
		const decls = node.nodes.filter(d => d.type === 'decl');
		for (const d of decls) {
			if (!COLOR_PROPS.test(d.prop)) continue;
			d.value = d.value.replace(/#[0-9a-f]{3,6}\b/gi, lit => {
				const to = mapColor(lit, d.prop, node, decls);
				if (to) mapped++;
				return to || lit;
			});
		}
	}
	// the theme's element rules (body.AdminThemeBridge h1..h4) outrank a layered class: heading
	// classes are repeated unlayered, with the class doubled to outrank them
	if (/^(Heading|Base|Article|Card|Modal)$/.test(component) && node.parent.type === 'root'
		&& node.selectors.filter(s => !s.startsWith(':where(')).every(s => /^\.uk-(h[1-6]|heading-(small|medium|large|xlarge|2xlarge|3xlarge)|article-title|card-title|modal-title)$/.test(s))) {
		const copy = node.clone();
		copy.selectors = node.selectors.filter(s => !s.startsWith(':where(')).map(s => s + s);
		copy.nodes = copy.nodes.filter(d => d.type === 'decl' && /^(font-size|line-height|font-weight|font-family|text-transform|letter-spacing)$/.test(d.prop));
		if (copy.nodes.length) headings.push(copy);
	}
});
// empty at-rules left behind
root.walkAtRules(at => { if (at.nodes && !at.nodes.length) at.remove(); });

// 4. scheme classes of AdminThemeUikit as aliases of data-pw-scheme, from our tokens. A document
// without data-pw-scheme (not a page of this theme: a module's preview iframe) takes the scheme of
// its body's class on <html> too, so the canvas follows
const tokens = postcss.parse(readFileSync(join(styles, '00-tokens.css'), 'utf8'));
const aliases = [];
const html = cls => `:root:not([data-pw-scheme]):has(> body.${cls})`;
tokens.walkRules(rule => {
	const s = rule.selectors;
	let to = null;
	if (s.includes('[data-pw-scheme="light"]')) to = ['.light-theme', html('light-theme')];
	else if (s.length === 1 && s[0] === '[data-pw-scheme="dark"]') to = ['.dark-theme', html('dark-theme')];
	else if (s.length === 1 && s[0] === '[data-pw-scheme="dark"][data-pw-variant="black"]') to = ['[data-pw-variant="black"] .dark-theme', '.dark-theme[data-pw-variant="black"]', html('dark-theme') + '[data-pw-variant="black"]'];
	else if (s.includes('[data-pw-scheme]') && s.includes('[data-pw-variant]')) to = ['.dark-theme', '.light-theme', html('dark-theme'), html('light-theme')];
	if (!to) return;
	const copy = rule.clone();
	copy.selectors = to;
	aliases.push(copy);
});
if (aliases.length < 4) { console.error('build-uikit: scheme blocks not found in 00-tokens.css'); process.exit(1); }
// AdminThemeUikit's custom properties (fields.css maps them on :root): computed again where a
// scheme class sits, or a dark subtree would keep the light values
{
	const fieldTokens = postcss.parse(readFileSync(join(styles, 'fields', '00-tokens.css'), 'utf8'));
	const rule = postcss.rule({ selectors: ['.dark-theme', '.light-theme', html('dark-theme'), html('light-theme')] });
	fieldTokens.walkRules(r => {
		if (r.selector !== ':root') return;
		r.walkDecls(d => { if (d.prop.startsWith('--pw-') && d.value.includes('var(')) rule.append(d.clone()); });
	});
	if (!rule.nodes.length) { console.error("build-uikit: AdminThemeUikit's properties not found in fields/00-tokens.css"); process.exit(1); }
	aliases.push(rule);
}

const inverseNodes = root.nodes.filter(n => n.raws.pwInverse);
inverseNodes.forEach(n => n.remove());
const layer = postcss.atRule({ name: 'layer', params: 'uikit' });
// UIkit's body text (#666): the foreground, softened toward the background, per scheme
layer.append(postcss.parse(':root, [data-pw-scheme], [data-pw-variant], .dark-theme, .light-theme { --uk-text: color-mix(in srgb, var(--foreground) 72%, var(--background)); }'));
layer.append(root.nodes);

const out = postcss.root();
out.append(postcss.comment({ text: `UIkit ${version} layer for AdminThemeBridge (ADR 0017): built by runtime/scripts/build-uikit.mjs from core's uikit.css (MIT, (c) YOOtheme GmbH). Do not edit.` }));
out.append(layer);
out.append(headings);
// the theme's own rules for the layer (src/styles/uikit-layer.css)
out.append(postcss.parse(readFileSync(join(styles, 'uikit-layer.css'), 'utf8')).nodes);
out.append(inverseNodes);
out.append(aliases);

const min = await transform(out.toString(), { loader: 'css', minify: true, target: ['chrome111', 'safari16.2', 'firefox121'] });
const banner = `/*! UIkit ${version} | https://getuikit.com | (c) YOOtheme GmbH | MIT License. Layer for AdminThemeBridge, built from core's uikit.css (runtime/scripts/build-uikit.mjs, ADR 0017) */\n`;
writeFileSync(dist + 'uikit.css', banner + min.code.replace(/^\/\*[\s\S]*?\*\/\s*/, ''));
console.log(`uikit.css: UIkit ${version}, ${kept} rules kept, ${dropped} dropped, ${mapped} colours on tokens, ${headings.length} heading rules`);
