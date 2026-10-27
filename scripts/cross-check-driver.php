<?php

declare(strict_types=1);

/**
 * The PHP half of `cross-check.mjs`.
 *
 * A real file rather than a string embedded in the Node script: PHP inside a
 * JavaScript template literal needs every backslash doubled, and a namespace
 * separator and a regex `\d` are both backslashes. The first version of this
 * got it wrong in two places at once and failed to parse, which is the good
 * outcome — the bad one is an escaping slip that still parses and quietly
 * changes what a regex matches.
 *
 * Prints one JSON object on stdout. Any failure is a non-zero exit.
 */

require __DIR__.'/../php/src/Conformance.php';

use ParticleAcademy\Conformance\Conformance;

$formatFloat = fn ($v): string => rtrim(rtrim(number_format((float) $v, 14, '.', ''), '0'), '.');

$satisfies = function (string $version, string $range): bool {
    $trimmed = trim($range);

    if ($trimmed === '*' || $trimmed === '') {
        return true;
    }

    if (! preg_match('/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/', trim($version), $vm)) {
        return false;
    }

    $v = [(int) $vm[1], (int) ($vm[2] ?? 0), (int) ($vm[3] ?? 0)];

    foreach (array_map('trim', explode('||', $trimmed)) as $clause) {
        if (! preg_match('/^(\^|~|>=|>|<=|<|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/', $clause, $m)) {
            continue;
        }

        $op = $m[1] ?: '=';
        $t = [(int) $m[2], (int) ($m[3] ?? 0), (int) ($m[4] ?? 0)];
        $cmp = $v <=> $t;

        $ok = match ($op) {
            '>=' => $cmp >= 0,
            '>' => $cmp > 0,
            '<=' => $cmp <= 0,
            '<' => $cmp < 0,
            '=' => $cmp === 0,
            '~' => $cmp >= 0 && $v[0] === $t[0] && $v[1] === $t[1],
            '^' => $t[0] === 0
                ? ($cmp >= 0 && $v[0] === 0 && $v[1] === $t[1])
                : ($cmp >= 0 && $v[0] === $t[0]),
            default => false,
        };

        if ($ok) {
            return true;
        }
    }

    return false;
};

/*
 * exchange/number-display, written the way a PHP package would write it: on
 * number_format, whose rounding is half away from zero on the decimal the
 * double prints as. This makes SPEC 17.10 a verdict rather than a sentence.
 *
 * Percent is the one place number_format alone is wrong: the first version
 * here passed `$abs * 100`, and 0203 went red -- 0.145 * 100 is
 * 14.499999999999998, which number_format rounds to 14. SPEC 6.2 step 2 scales
 * the DECIMAL, so this leg does too: the shortest repr (json_encode, under
 * serialize_precision -1) gets its exponent raised by 2 and is parsed back,
 * which is an exact decimal shift, not a binary multiply.
 */
$percentOf = function (float $abs): float {
    $repr = json_encode($abs, JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR);
    [$mantissa, $exponent] = array_pad(explode('e', strtolower($repr)), 2, '0');

    return (float) ($mantissa.'e'.((int) $exponent + 2));
};
$symbols = ['USD' => '$', 'EUR' => '€', 'GBP' => '£', 'JPY' => '¥', 'CNY' => '¥', 'INR' => '₹', 'AUD' => 'A$', 'CAD' => 'C$', 'CHF' => 'CHF', 'KRW' => '₩'];

$display = function (array $in) use ($formatFloat, $symbols, $percentOf): string {
    $t = $in['t'];
    $v = $in['v'] ?? null;
    $kind = $in['format']['kind'] ?? null;
    $canonical = match ($t) {
        'number' => ($s = $formatFloat($v)) === '-0' ? '0' : $s,
        'bool' => $v ? 'TRUE' : 'FALSE',
        'empty' => '',
        default => (string) $v,
    };

    if ($t === 'number' && in_array($kind, ['number', 'currency', 'percent'], true)) {
        $d = $in['format']['decimals'] ?? ['number' => 0, 'currency' => 2, 'percent' => 1][$kind];
        $abs = abs((float) $v);
        $digits = $kind === 'percent'
            ? number_format($percentOf($abs), $d, '.', '')
            : number_format($abs, $d, '.', ',');
        $sign = ((float) $v < 0 && trim($digits, '0.,') !== '') ? '-' : '';

        return match ($kind) {
            'percent' => $sign.$digits.'%',
            'currency' => $sign.($symbols[$in['format']['currency'] ?? 'USD'] ?? ($in['format']['currency'].' ')).$digits,
            default => $sign.$digits,
        };
    }

    if (in_array($t, ['date', 'datetime'], true) && in_array($kind, ['date', 'datetime'], true)) {
        $date = substr((string) $v, 0, 10);

        return $kind === 'date' ? $date : $date.' '.($t === 'datetime' ? substr((string) $v, 11, 8) : '00:00:00');
    }

    return $canonical;
};

$dropped = ['cell-style-dropped', 'chart', 'comment', 'composite-element', 'embedded-object', 'hidden-column', 'hidden-element', 'hidden-row', 'hidden-sheet', 'hidden-slide', 'image', 'link', 'nested-block', 'non-table-item', 'run-style-dropped', 'shape', 'table-clipped'];
$approximated = ['cell-truncated', 'chart-as-table', 'code-as-text', 'csv-escaped', 'format-approximated', 'formula-as-value', 'formula-uncomputed', 'header-rows-flattened', 'layout-not-preserved', 'markup-as-text', 'merge-flattened', 'merge-unread', 'quote-flattened', 'structure-not-recovered', 'typed-as-text'];

$classifyKind = fn (string $kind): ?string => in_array($kind, $dropped, true) ? 'dropped' : (in_array($kind, $approximated, true) ? 'approximated' : null);

$mergeReports = function (array $a, array $b): array {
    $out = ['dropped' => [], 'approximated' => [], 'guard' => ['findings' => []]];
    $rules = [];
    foreach (['dropped', 'approximated'] as $list) {
        $byKind = [];
        foreach ([$a, $b] as $report) {
            foreach ($report[$list] ?? [] as $entry) {
                $kind = $entry['kind'];
                $byKind[$kind] ??= ['kind' => $kind, 'count' => 0];
                $byKind[$kind]['count'] += $entry['count'];
                foreach ($entry['where'] ?? [] as $where) {
                    $byKind[$kind]['where'] ??= [];
                    if (count($byKind[$kind]['where']) < 16) {
                        $byKind[$kind]['where'][] = $where;
                    }
                }
            }
        }
        ksort($byKind, SORT_STRING);
        $out[$list] = array_values($byKind);
    }
    foreach ([$a, $b] as $report) {
        foreach ($report['guard']['findings'] ?? [] as $finding) {
            $rules[$finding['rule']] = ($rules[$finding['rule']] ?? 0) + $finding['count'];
        }
    }
    ksort($rules, SORT_STRING);
    foreach ($rules as $rule => $count) {
        $out['guard']['findings'][] = ['rule' => (string) $rule, 'count' => $count];
    }

    return $out;
};

$out = [
    'shared/satisfies-range' => Conformance::runTable(
        'shared/satisfies-range',
        fn (array $c): bool => $satisfies($c['input']['version'], $c['input']['range']),
    ),
    'shared/decimal' => Conformance::runTable(
        'shared/decimal',
        fn (array $c) => match ($c['fn']) {
            'formatFloat' => $formatFloat($c['input']['value']),
            'numericStringToNumber' => $c['input']['value'] + 0,
            'roundMoney' => (int) round($c['input']['value']),
        },
    ),
    'exchange/number-display' => Conformance::runTable('exchange/number-display', fn (array $c): string => $display($c['input'])),
    // A report holds lists and one keyed object (guard), never an empty `{}`,
    // so PHP's `[]`/`{}` blind spot (shared/value-equality/0210) cannot hide
    // a disagreement here.
    'exchange/report-kinds' => Conformance::runTable('exchange/report-kinds', fn (array $c) => $c['fn'] === 'classifyKind' ? $classifyKind($c['input']['kind']) : $mergeReports($c['input']['a'], $c['input']['b'])),
    '__version' => Conformance::version(),
    '__suites' => Conformance::listSuites(),
];

echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
