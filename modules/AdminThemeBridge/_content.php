<?php namespace ProcessWire;

/**
 * Content region: breadcrumbs, headline, add-new, process output
 *
 * Ids kept from upstream themes because module scripts and hooks look for them:
 * #main, #content (.pw-content), #pw-content-head, #pw-content-title, #pw-content-body.
 *
 * FileCompiler=0
 */

if(!defined("PROCESSWIRE")) die();

/** @var AdminThemeBridge $adminTheme */
/** @var Page $page */
/** @var string $headline */
/** @var string $content */
/** @var string $layout */

?>
<main id='main' class='pw-container'>
	<div id='content' class='pw-content'>
		<header id='pw-content-head'>
			<?php if($layout !== 'modal') echo $adminTheme->renderBreadcrumbs(); ?>
			<div id='pw-content-head-buttons'><?php echo $adminTheme->renderAddNewButton(); ?></div>
			<?php
			if($adminTheme->isLoginScreen()) {
				// login card: the mark (or the site's logo) as title; the headline stays for screen readers
				echo "<h1 id='pw-content-title'><a class='pw-logo-link' href='" . $this->wire()->sanitizer->entities($this->wire()->config->urls->root) . "'>" .
					$adminTheme->renderLogo() . "</a><span class='pw-sr-only'>$headline</span></h1>";
				echo $adminTheme->renderNotices($this->wire()->notices);
			} else if($headline !== '' && !$adminTheme->isModal) {
				echo "<h1 id='pw-content-title'>$headline</h1>";
			}
			?>
		</header>
		<div id='pw-content-body'>
			<?php echo $page->get('body') . $content; ?>
		</div>
	</div>
</main>
