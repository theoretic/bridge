<?php namespace ProcessWire;

/**
 * Scripts before </body>
 *
 * FileCompiler=0
 */

if(!defined("PROCESSWIRE")) die();

/** @var AdminThemeBridge $adminTheme */

?>
<script<?php echo $adminTheme->nonceAttr(); ?>>
	ProcessWireAdminTheme.init();
</script>
