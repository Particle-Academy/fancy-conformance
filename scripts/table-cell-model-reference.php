<?php

declare(strict_types=1);

/**
 * Run the dark-slide PHP reference over every `dark-slide/table-cell-model`
 * case and print the goldens it produces, as JSON, one per case in order.
 *
 *   php scripts/table-cell-model-reference.php <path to dark-slide/src> < cases.json
 *
 * Called by `build-table-cell-model-goldens.py`, which owns the file. The split
 * is deliberate: PHP's `json_decode($s, true)` turns `{}` into `[]`, so a PHP
 * script that rewrote cases.json would silently change every empty object in
 * it. PHP computes; Python writes.
 *
 * The projection is the suite's run shape, identical to the Python port's
 * runner (`dark-slide-py/tests/conformance/test_table_cell_model.py`): every
 * fractional quantity becomes the integer unit the writer emits, then a string.
 */

$src = rtrim($argv[1] ?? '', '/\\');
if ($src === '' || ! is_file($src.'/Table/TableResolver.php')) {
    fwrite(STDERR, "usage: php table-cell-model-reference.php <dark-slide/src>\n");
    exit(2);
}

spl_autoload_register(static function (string $class) use ($src): void {
    $prefix = 'DarkSlide'.chr(92);
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $file = $src.'/'.str_replace(chr(92), '/', substr($class, strlen($prefix))).'.php';
    if (is_file($file)) {
        require $file;
    }
});

use DarkSlide\Helpers\Emu;
use DarkSlide\Table\TableResolver;

$suite = json_decode((string) stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);

$shape = static function (array $cell): array {
    $borders = [];
    foreach (['left', 'right', 'top', 'bottom'] as $side) {
        $spec = $cell['borders'][$side];
        $borders[$side] = $spec === null ? null : [
            'widthEmu' => (string) Emu::fromPt((float) $spec['width']),
            'color' => $spec['color'],
            'style' => $spec['style'],
        ];
    }
    $padding = [];
    foreach (['left', 'right', 'top', 'bottom'] as $side) {
        $padding[$side] = (string) Emu::fromPt((float) $cell['padding'][$side]);
    }

    return [
        'text' => $cell['text'],
        'bold' => $cell['bold'] ? '1' : '0',
        'italic' => $cell['italic'] ? '1' : '0',
        'underline' => $cell['underline'] ? '1' : '0',
        'color' => $cell['color'],
        'fill' => $cell['fill'],
        'align' => $cell['align'],
        'anchor' => $cell['anchor'],
        'fontSizeHundredths' => (string) Emu::hundredthsOfPoint((float) $cell['fontSize']),
        'letterSpacingHundredths' => (string) Emu::hundredthsOfPoint((float) $cell['letterSpacing']),
        'caps' => $cell['caps'],
        'padding' => $padding,
        'borders' => $borders,
        'colSpan' => (string) $cell['colSpan'],
        'rowSpan' => (string) $cell['rowSpan'],
        'merged' => $cell['merged'],
    ];
};

$out = [];
foreach ($suite['cases'] as $case) {
    $input = $case['input'];
    $table = TableResolver::resolve($input['element'], is_array($input['theme'] ?? null) ? $input['theme'] : []);

    $out[] = $case['fn'] === 'gridWidthsEmu'
        ? array_map('strval', TableResolver::columnWidthsEmu($table['columns'], (int) $input['totalEmu']))
        : $shape($table['rows'][$input['row']]['cells'][$input['col']]);
}

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
