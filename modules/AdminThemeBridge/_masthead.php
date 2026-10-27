<?php namespace ProcessWire;

/**
 * Masthead: logo, primary nav, user nav, search, notices
 *
 * FileCompiler=0
 */

if(!defined("PROCESSWIRE")) die();

/** @var Config $config */
/** @var AdminThemeBridge $adminTheme */
/** @var Notices $notices */

$homeUrl = $adminTheme->isLoggedIn ? $config->urls->admin : $config->urls->root;

?>
<?php if(!$adminTheme->isLoginScreen()): ?>
<a class='pw-sr-only pw-skip-link' href='#main'><?php echo $adminTheme->wire()->sanitizer->entities1($adminTheme->shellLabel('skip')); ?></a>
<header id='pw-masthead' class='pw-masthead'>
	<div class='pw-container'>
		<a class='pw-logo-link' href='<?php echo $adminTheme->wire()->sanitizer->entities($homeUrl); ?>'><?php echo $adminTheme->renderLogo(); ?></a>
		<?php if($adminTheme->isLoggedIn): ?>
		<button type='button' class='pw-nav-toggle' aria-controls='pw-nav' aria-expanded='false' aria-label='<?php echo $adminTheme->wire()->sanitizer->entities1($adminTheme->shellLabel('menu')); ?>'><i class='fa fa-bars'></i></button>
		<nav class='pw-nav' id='pw-nav' aria-label='<?php echo $adminTheme->wire()->sanitizer->entities1($adminTheme->shellLabel('mainNav')); ?>'>
			<?php echo $adminTheme->renderPrimaryNav(); ?>
		</nav>
		<div class='pw-masthead-right'>
			<?php
			echo $adminTheme->renderUserNav();
			if($adminTheme->isEditor) {
				/** @var ProcessPageSearch $search */
				$search = $modules->get('ProcessPageSearch');
				// a search landmark with a named field (audit SU4); ids as upstream prints them
				$searchLabel = $adminTheme->wire()->sanitizer->entities1($adminTheme->shellLabel('search'));
				echo str_replace(
					array("<form id='ProcessPageSearchForm'", "id='ProcessPageSearchQuery'"),
					array("<form role='search' aria-label='$searchLabel' id='ProcessPageSearchForm'", "id='ProcessPageSearchQuery' aria-label='$searchLabel'"),
					$search->renderSearchForm($adminTheme->shellLabel('search'))
				);
			}
			?>
		</div>
		<?php endif; ?>
	</div>
</header>
<?php endif; ?>
<?php
// on the login screen the notices (a failed login) go into the card, below the mark (_content.php)
if(!$adminTheme->isLoginScreen()) echo $adminTheme->renderNotices($notices);
echo $adminTheme->renderExtraMarkup('masthead');
