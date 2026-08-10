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
    '__version' => Conformance::version(),
    '__suites' => Conformance::listSuites(),
];

echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
