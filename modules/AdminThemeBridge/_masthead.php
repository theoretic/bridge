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
<header id='pw-masthead' class='pw-masthead'>
	<div class='pw-container'>
		<a class='pw-logo-link' href='<?php echo $homeUrl; ?>'><?php echo $adminTheme->renderLogo(); ?></a>
		<?php if($adminTheme->isLoggedIn): ?>
		<button type='button' class='pw-nav-toggle' aria-controls='pw-nav' aria-expanded='false' aria-label='<?php echo $adminTheme->_('Menu'); ?>'><i class='fa fa-bars'></i></button>
		<nav class='pw-nav' id='pw-nav'>
			<?php echo $adminTheme->renderPrimaryNav(); ?>
		</nav>
		<div class='pw-masthead-right'>
			<?php
			echo $adminTheme->renderUserNav();
			if($adminTheme->isEditor) {
				/** @var ProcessPageSearch $search */
				$search = $modules->get('ProcessPageSearch');
				echo $search->renderSearchForm();
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
