<?php

declare(strict_types=1);

use ParticleAcademy\Conformance\Conformance;

/**
 * The PHP loader must behave identically to the TypeScript one in `src/`.
 *
 * Two loaders for one fixture format is itself a duplicated contract, so it is
 * held to the same standard as everything else here: the same guards, the same
 * summary shape, asserted on both sides.
 */
it('finds the suites regardless of where it is called from', function () {
    // The bug this replaces: both existing parity harnesses hard-coded
    // `../../holy-sheet/src/`, so they ran in exactly one directory layout and
    // silently no-opped everywhere else — including CI.
    $before = getcwd();

    try {
        chdir(sys_get_temp_dir());
        expect(Conformance::listSuites())->toContain('shared/decimal');
    } finally {
        chdir((string) $before);
    }
});

it('reports the fixture version', function () {
    expect(Conformance::version())->toMatch('/^\d+\.\d+\.\d+$/');
});

it('rejects a skip with no reason at load time', function () {
    $root = sys_get_temp_dir().'/conformance-'.bin2hex(random_bytes(6));
    mkdir($root.'/suites/bad', 0o777, true);
    file_put_contents($root.'/suites/bad/manifest.json', json_encode(['suite' => 'bad', 'caseFormat' => 'table']));
    file_put_contents($root.'/suites/bad/cases.json', json_encode(['suite' => 'bad', 'cases' => [
        ['id' => '0001-x', 'title' => 'x', 'since' => '0.1.0', 'input' => [], 'expected' => 1, 'skip' => ['rust' => '   ']],
    ]]));

    // Reached through the REAL loader by handing it an explicit root — not
    // through a copy of the guard living in this file.
    expect(fn () => Conformance::cases('bad', $root))
        ->toThrow(RuntimeException::class, 'skips rust with no reason');
});

it('rejects a duplicate case id at load time', function () {
    $root = sys_get_temp_dir().'/conformance-'.bin2hex(random_bytes(6));
    mkdir($root.'/suites/dup', 0o777, true);
    file_put_contents($root.'/suites/dup/manifest.json', json_encode(['suite' => 'dup', 'caseFormat' => 'table']));
    file_put_contents($root.'/suites/dup/cases.json', json_encode(['suite' => 'dup', 'cases' => [
        ['id' => '0001-x', 'title' => 'x', 'since' => '0.1.0', 'input' => [], 'expected' => 1],
        ['id' => '0001-x', 'title' => 'y', 'since' => '0.1.0', 'input' => [], 'expected' => 2],
    ]]));

    expect(fn () => Conformance::cases('dup', $root))
        ->toThrow(RuntimeException::class, 'duplicate case id');
});

it('loads a well-formed skip and keeps its reason', function () {
    // The positive half. Without it, the two tests above would also pass
    // against a loader that rejected EVERY skip.
    $root = sys_get_temp_dir().'/conformance-'.bin2hex(random_bytes(6));
    mkdir($root.'/suites/ok', 0o777, true);
    file_put_contents($root.'/suites/ok/manifest.json', json_encode(['suite' => 'ok', 'caseFormat' => 'table']));
    file_put_contents($root.'/suites/ok/cases.json', json_encode(['suite' => 'ok', 'cases' => [
        ['id' => '0001-x', 'title' => 'x', 'since' => '0.1.0', 'input' => [], 'expected' => 1, 'skip' => ['rust' => 'no decimal type yet']],
    ]]));

    expect(Conformance::cases('ok', $root)[0]['skip']['rust'])->toBe('no decimal type yet');
});

it('counts pass, fail and skip separately', function () {
    $summary = Conformance::runTable('shared/satisfies-range', fn (array $c): bool => true);

    $expectedFalse = \count(array_filter(
        Conformance::cases('shared/satisfies-range'),
        fn (array $c): bool => $c['expected'] === false,
    ));

    expect($summary['failed'])->toBe($expectedFalse)
        ->and($summary['ok'])->toBeFalse();
});

it('treats a throwing implementation as a failure, not a fatal', function () {
    $summary = Conformance::runTable('shared/satisfies-range', function (array $c) {
        throw new RuntimeException('boom');
    });

    expect($summary['ok'])->toBeFalse()
        ->and($summary['passed'])->toBe(0)
        ->and($summary['results'][0]['actual'])->toContain('threw: boom');
});

it('prints every skip by name and reason', function () {
    // A bare "3 skipped" in a CI log reads identically to full coverage.
    $summary = [
        'suite' => 's', 'language' => 'php', 'suiteVersion' => '0.1.0',
        'passed' => 0, 'failed' => 0, 'skipped' => 1,
        'results' => [['id' => '0001-x', 'title' => 't', 'status' => 'skip', 'reason' => 'no decimal type yet']],
        'ok' => true,
    ];

    expect(Conformance::formatSummary($summary))->toContain('SKIP 0001-x — no decimal type yet');
});

it('agrees with the fixtures on the decimal table', function () {
    // PHP is the declared reference for this suite, so a failure here means the
    // GOLDENS are wrong rather than the implementation.
    $formatFloat = fn ($v): string => rtrim(rtrim(number_format((float) $v, 14, '.', ''), '0'), '.');

    $summary = Conformance::runTable('shared/decimal', fn (array $c) => match ($c['fn']) {
        'formatFloat' => $formatFloat($c['input']['value']),
        'numericStringToNumber' => $c['input']['value'] + 0,
        'roundMoney' => (int) round($c['input']['value']),
    });

    expect($summary['ok'])->toBeTrue(Conformance::formatSummary($summary));
    expect($summary['skipped'])->toBe(0);
});

it('agrees with the fixtures on the satisfies-range table', function () {
    // The same 17 rows fancy-flow-php, fancy-flow and fancy-ui-cli each carry.
    // Three independent implementations of this function have not drifted, and
    // the shared table is the only thing they do differently from every other
    // triplicated contract in the suite.
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

    $summary = Conformance::runTable(
        'shared/satisfies-range',
        fn (array $c): bool => $satisfies($c['input']['version'], $c['input']['range']),
    );

    expect($summary['ok'])->toBeTrue(Conformance::formatSummary($summary));
    expect($summary['skipped'])->toBe(0);
});
