// Trusted Types guard (ADR 0020 decision 8): fails the build when a source writes HTML, a script
// or a script URL past the `bridge` policy. Every innerHTML, outerHTML, insertAdjacentHTML,
// DOMParser and script text or src in runtime/src goes through util/trusted.ts (toHTML,
// toScript, toScriptURL, parseHTML) or, in the classic scripts, ProcessWireAdminTheme.trusted
// (trusted.html, .script, .scriptURL, .parse). Clearing is replaceChildren(), text is
// textContent. document.write, inline event handler attributes and javascript: URLs in markup
// are refused outright. A line the rules misread says why with a `tt-ok: <reason>` comment.
//
// Original work, MIT.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const OWN = new Set(['util/trusted.ts']);
const files = [];
(function walk(dir) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p);
		else if (/\.(ts|js)$/.test(name)) files.push(p);
	}
})(root);

// a policy call right after the sink
const POLICY = String.raw`(?:toHTML|toScript|toScriptURL|(?:[\w.]*\.)?trusted\.(?:html|script|scriptURL)|this\.html|self\.trusted\.(?:html|script|scriptURL))\(`;
const RULES = [
	{ name: 'innerHTML/outerHTML not through the policy', re: new RegExp(String.raw`\.(?:inner|outer)HTML\s*=(?!=)\s*(?!\s)(?!${POLICY})`) },
	{ name: 'insertAdjacentHTML not through the policy', re: new RegExp(String.raw`insertAdjacentHTML\(\s*[^,]+,\s*(?!\s)(?!${POLICY})`) },
	{ name: 'DOMParser outside parseHTML()/trusted.parse()', re: /parseFromString\(\s*(?!this\.html\(|toHTML\()/ },
	{ name: 'document.write', re: /document\.(?:write|writeln)\s*\(/ },
	{ name: 'createContextualFragment, srcdoc or setHTMLUnsafe', re: /createContextualFragment\(|\.srcdoc\s*=|setHTMLUnsafe\(/ },
	{ name: 'script text not through the policy', re: new RegExp(String.raw`\b(?:s|live|script)\.(?:text|textContent|innerText)\s*=(?!=)\s*(?!\s)(?!${POLICY})`) },
	{ name: 'script src not through the policy', re: new RegExp(String.raw`\b(?:s|live|script)\.src\s*=(?!=)\s*(?!\s)(?!${POLICY})`) },
	{ name: 'inline event handler in markup', re: /["'`<][^"'`]*\son[a-z]+=["']/ },
	{ name: 'javascript: URL', re: /javascript:/ },
	{ name: 'eval or new Function', re: /\beval\(|new Function\(/ },
];

const hits = [];
for (const file of files) {
	const rel = relative(root, file).replace(/\\/g, '/');
	if (OWN.has(rel)) continue;
	readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, n) => {
		const code = line.trim();
		if (!code || code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
		if (/tt-ok:/.test(line)) return;
		// the policy's own parser in the theme script
		if (rel === 'classic/main.js' && /parse: function\(s\) \{ return new DOMParser\(\)\.parseFromString\(this\.html\(s\)/.test(line)) return;
		for (const rule of RULES) {
			if (rule.re.test(line)) hits.push(`${rel}:${n + 1}: ${rule.name}: ${code.slice(0, 140)}`);
		}
	});
}
if (hits.length) {
	console.error(`check-sinks: ${hits.length} Trusted Types sink(s) past the policy (ADR 0020):\n` + hits.join('\n'));
	process.exit(1);
}
console.log(`check-sinks: ${files.length} sources, every HTML and script sink through the bridge policy`);
