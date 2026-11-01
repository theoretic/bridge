/**
 * Motion the user asked the system to reduce (audit UX3): the theme's CSS turns its transitions
 * off under prefers-reduced-motion; these keep the scripts' flashes, fades and smooth scrolls to
 * the same rule. The classic scripts ask ProcessWireAdminTheme.still().
 */

/** The user prefers reduced motion */
export function still(): boolean {
	return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** element.animate(), or nothing under reduced motion (or where animate() is missing) */
export function animate(el: Element, frames: Keyframe[], options: number | KeyframeAnimationOptions): Animation | null {
	return still() || typeof el.animate !== 'function' ? null : el.animate(frames, options);
}

/** 'smooth', or 'auto' under reduced motion: for scrollIntoView() and scrollTo() */
export function smooth(): ScrollBehavior {
	return still() ? 'auto' : 'smooth';
}
