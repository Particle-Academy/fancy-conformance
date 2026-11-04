<?php

declare(strict_types=1);

/**
 * Run fancy-flow-php's `TemplateReferences` over each `flow/template-references`
 * input and print the goldens, as JSON, one per row in order.
 *
 *   php scripts/flow-template-references-reference.php <fancy-flow-php checkout> < inputs.json
 *
 * Called by `build-flow-template-references-cases.py`, which owns the file: PHP's
 * json_decode turns `{}` into `[]`, so PHP computes and Python writes.
 */

$root = rtrim($argv[1] ?? '', '/\\');
if ($root === '' || ! is_file($root.'/vendor/autoload.php')) {
    fwrite(STDERR, "usage: php flow-template-references-reference.php <fancy-flow-php checkout with vendor/>\n");
    exit(2);
}
require $root.'/vendor/autoload.php';

$analysis = 'FancyFlow'.chr(92).'Analysis'.chr(92).'TemplateReferences';
$registryClass = 'FancyFlow'.chr(92).'NodeKindRegistry';
$builtin = 'FancyFlow'.chr(92).'Registry'.chr(92).'Builtin';
$workflow = 'FancyFlow'.chr(92).'Workflow';

$goldens = [];
foreach (json_decode((string) stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR) as $schema) {
    $registry = new $registryClass;
    $builtin::register($registry, withStructural: true);
    $import = $workflow::import($schema, lenient: true, registry: $registry, templateReferences: $analysis::OFF);

    $findings = $analysis::findings($import->graph->nodes, $import->graph->edges, $registry);
    usort($findings, static fn (array $a, array $b): int => [$a['nodeId'], $a['configKey'], $a['path']] <=> [$b['nodeId'], $b['configKey'], $b['path']]);
    $goldens[] = $findings;
}

echo json_encode($goldens, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
