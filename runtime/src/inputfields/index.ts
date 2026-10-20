/**
 * Inputfield behaviours for pages without the legacy stack. Public surface mirrors the names
 * of upstream's `Inputfields` object where the semantics are the same.
 */

import { initCollapse, open, close, toggle, isCollapsed, setupCollapseEvents } from './collapse';
import { initDependencies, evaluate, isHidden, setupDependencyEvents } from './dependencies';
import { recalcColumns } from './columns';
import { setupFormEvents } from './forms';
import { installFacade } from './facade';
import { initCounters, setupCounterEvents } from './counter';
import { initToggles, setupToggleEvents } from './toggle';
import { initCheckboxes, setupCheckboxEvents } from './checkboxes';
import { initLanguageTabs, setupLanguageTabEvents } from './langtabs';
import { initWidgets } from '../fields/registry';
import { legacyLoaded } from '../legacy';

let eventsReady = false;

// roots init() ran on in the current task: a 'reloaded' that follows right after (a loader
// initialises new content, then announces each field) needs no second pass (audit B17)
const recent: Node[] = [];
let clearing = false;
function remember(root: ParentNode): void {
	recent.push(root as Node);
	if (clearing) return;
	clearing = true;
	window.setTimeout(() => { recent.length = 0; clearing = false; }, 0);
}
function covered(el: Node): boolean {
	return recent.some(root => root === el || root.contains(el));
}

export const Inputfields = {
	/**
	 * Initialise behaviours under root (document by default). Safe to call again for new content.
	 */
	init(root: ParentNode = document): void {
		if (legacyLoaded()) return;
		remember(root);
		initCollapse(root);
		initDependencies(root, () => recalcColumns(root));
		recalcColumns(root);
		initCounters(root);
		initToggles(root);
		initCheckboxes(root);
		initLanguageTabs(root);
		initWidgets(root);
		if (!eventsReady) {
			eventsReady = true;
			setupCollapseEvents();
			setupDependencyEvents(() => recalcColumns(document));
			setupFormEvents();
			setupCounterEvents();
			setupToggleEvents();
			setupCheckboxEvents();
			setupLanguageTabEvents();
			installFacade();
			document.addEventListener('reloaded', e => {
				const li = e.target as HTMLElement;
				if (li && li.nodeType === 1 && !covered(li)) Inputfields.init(li);
			});
		}
	},
	open,
	close,
	toggle,
	isCollapsed,
	hidden: isHidden,
	evaluate,
	recalcColumns,
};

export type InputfieldsApi = typeof Inputfields;
