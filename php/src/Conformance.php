<?php

declare(strict_types=1);

namespace ParticleAcademy\Conformance;

/**
 * Loader for the shared conformance fixtures, for PHP implementations.
 *
 * Deliberately the same shape as the TypeScript loader in `src/index.ts`, so a
 * reviewer comparing two implementations' CI is comparing like with like.
 *
 * Zero runtime dependencies: a fixture loader that needs a framework booted is
 * a fixture loader that gets skipped.
 */
final class Conformance
{
    /**
     * The repository root, found by walking up to whatever directory holds
     * `suites/`.
     *
     * NOT a fixed `__DIR__.'/../..'`, and not a path to a sibling checkout. The
     * two parity harnesses this package replaces both hard-coded
     * `../../holy-sheet/src/`, which is why they ran in exactly one directory
     * layout and silently no-opped everywhere else — including in CI, where it
     * mattered.
     */
    public static function root(): string
    {
        $dir = __DIR__;

        for ($i = 0; $i < 6; $i++) {
            if (is_dir($dir.'/suites')) {
                return $dir;
            }
            $parent = \dirname($dir);
            if ($parent === $dir) {
                break;
            }
            $dir = $parent;
        }

        throw new \RuntimeException(
            'fancy-conformance: could not locate the suites/ directory.'
        );
    }

    /** The fixture collection's own version — a runner must print this. */
    public static function version(): string
    {
        return trim((string) file_get_contents(self::root().'/VERSION'));
    }

    /**
     * Every suite id present, e.g. `['shared/decimal', 'shared/satisfies-range']`.
     *
     * @return list<string>
     */
    public static function listSuites(): array
    {
        $root = self::root().'/suites';
        $found = [];

        $walk = function (string $dir) use (&$walk, $root, &$found): void {
            foreach (scandir($dir) ?: [] as $entry) {
                if ($entry === '.' || $entry === '..') {
                    continue;
                }
                $child = $dir.'/'.$entry;
                if (! is_dir($child)) {
                    continue;
                }
                if (is_file($child.'/manifest.json')) {
                    $found[] = str_replace('\\', '/', substr($child, \strlen($root) + 1));
                } else {
                    $walk($child);
                }
            }
        };

        $walk($root);
        sort($found);

        return $found;
    }

    /** @return array<string,mixed> */
    public static function manifest(string $suite, ?string $root = null): array
    {
        $path = ($root ?? self::root()).'/suites/'.$suite.'/manifest.json';
        $decoded = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);

        if (! \is_array($decoded)) {
            throw new \RuntimeException("fancy-conformance: {$path} is not an object.");
        }

        return $decoded;
    }

    /**
     * Load a table suite's cases.
     *
     * `$root` exists so the load-time guards below can be tested against a
     * throwaway fixture tree, rather than a test re-implementing them. A guard
     * asserted by a copy of itself is the failure mode this whole package
     * exists to stop, and it would be an embarrassing one to ship here.
     *
     * @return list<array<string,mixed>>
     */
    public static function cases(string $suite, ?string $root = null): array
    {
        $manifest = self::manifest($suite, $root);

        if (($manifest['caseFormat'] ?? null) !== 'table') {
            throw new \RuntimeException(
                "fancy-conformance: suite \"{$suite}\" is not a table suite."
            );
        }

        $file = ($root ?? self::root()).'/suites/'.$suite.'/'.($manifest['cases'] ?? 'cases.json');
        $decoded = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
        $cases = $decoded['cases'] ?? null;

        if (! \is_array($cases) || $cases === []) {
            throw new \RuntimeException("fancy-conformance: suite \"{$suite}\" has no cases.");
        }

        self::assertUsableCases($suite, $cases);

        return array_values($cases);
    }

    /**
     * Reject a case table that cannot do its job, at LOAD time.
     *
     * A skip with no reason and a duplicate id are both otherwise silent: the
     * suite still loads, still reports green, and still covers less than it
     * appears to. That is the exact failure this package exists to stop.
     *
     * @param  array<int,array<string,mixed>>  $cases
     */
    private static function assertUsableCases(string $suite, array $cases): void
    {
        $seen = [];

        foreach ($cases as $case) {
            $id = (string) ($case['id'] ?? '');

            if (isset($seen[$id])) {
                throw new \RuntimeException(
                    "fancy-conformance: suite \"{$suite}\" has duplicate case id \"{$id}\"."
                );
            }
            $seen[$id] = true;

            foreach (($case['skip'] ?? []) as $language => $reason) {
                if (! \is_string($reason) || trim($reason) === '') {
                    throw new \RuntimeException(
                        "fancy-conformance: case \"{$suite}/{$id}\" skips {$language} with no reason. "
                        .'A skip must say why, because every runner prints it.'
                    );
                }
            }
        }
    }

    /**
     * Run a table suite against a PHP implementation.
     *
     * `$impl` receives one case and returns the value to compare. A case that
     * throws is a FAILURE with the message recorded, not a fatal — an
     * implementation blowing up is data about the implementation.
     *
     * @param  callable(array<string,mixed>): mixed  $impl
     * @return array{suite:string,language:string,suiteVersion:string,passed:int,failed:int,skipped:int,results:list<array<string,mixed>>,ok:bool}
     */
    public static function runTable(string $suite, callable $impl, string $language = 'php'): array
    {
        $results = [];

        foreach (self::cases($suite) as $case) {
            $reason = $case['skip'][$language] ?? null;

            if ($reason !== null) {
                $results[] = ['id' => $case['id'], 'title' => $case['title'], 'status' => 'skip', 'reason' => $reason];

                continue;
            }

            try {
                $actual = $impl($case);
            } catch (\Throwable $e) {
                $results[] = [
                    'id' => $case['id'],
                    'title' => $case['title'],
                    'status' => 'fail',
                    'expected' => $case['expected'],
                    'actual' => 'threw: '.$e->getMessage(),
                ];

                continue;
            }

            $results[] = self::equals($actual, $case['expected'])
                ? ['id' => $case['id'], 'title' => $case['title'], 'status' => 'pass']
                : [
                    'id' => $case['id'],
                    'title' => $case['title'],
                    'status' => 'fail',
                    'expected' => $case['expected'],
                    'actual' => $actual,
                ];
        }

        $count = fn (string $status): int => \count(array_filter($results, fn ($r): bool => $r['status'] === $status));
        $failed = $count('fail');

        return [
            'suite' => $suite,
            'language' => $language,
            'suiteVersion' => self::version(),
            'passed' => $count('pass'),
            'failed' => $failed,
            'skipped' => $count('skip'),
            'results' => $results,
            'ok' => $failed === 0,
        ];
    }

    /**
     * A summary a CI log can be read from — including every skip, by name and
     * reason.
     *
     * Skips are printed unconditionally and never folded into a bare count.
     * "3 skipped" in a log looks the same as full coverage at a glance, which
     * is how a suite stops meaning anything without anyone deciding it should.
     *
     * @param  array<string,mixed>  $summary
     */
    public static function formatSummary(array $summary): string
    {
        $lines = [
            "{$summary['suite']} [{$summary['language']}] — fancy-conformance {$summary['suiteVersion']}",
            "  {$summary['passed']} passed, {$summary['failed']} failed, {$summary['skipped']} skipped",
        ];

        foreach ($summary['results'] as $r) {
            if ($r['status'] === 'skip') {
                $lines[] = "  SKIP {$r['id']} — {$r['reason']}";
            }
            if ($r['status'] === 'fail') {
                $lines[] = "  FAIL {$r['id']} {$r['title']}";
                $lines[] = '       expected: '.self::preview($r['expected']);
                $lines[] = '       actual:   '.self::preview($r['actual']);
            }
        }

        return implode("\n", $lines);
    }

    private static function preview(mixed $value): string
    {
        $s = \is_string($value) ? $value : json_encode($value, JSON_UNESCAPED_UNICODE);
        $s = (string) $s;

        return \strlen($s) > 120
            ? substr($s, 0, 60).'…'.substr($s, -40).' (len '.\strlen($s).')'
            : $s;
    }

    /**
     * Order-sensitive for lists, order-insensitive for object keys.
     *
     * Numeric comparison is exact for integers and epsilon-based for floats,
     * because a golden written as `0.002` in JSON is a decimal literal and the
     * nearest double to it is not the nearest double to every language's parse
     * of the same text.
     */
    public static function equals(mixed $a, mixed $b): bool
    {
        if (\is_array($a) && \is_array($b)) {
            if (\count($a) !== \count($b)) {
                return false;
            }
            foreach ($a as $k => $v) {
                if (! \array_key_exists($k, $b) || ! self::equals($v, $b[$k])) {
                    return false;
                }
            }

            return true;
        }

        if ((\is_int($a) || \is_float($a)) && (\is_int($b) || \is_float($b))) {
            if (\is_int($a) && \is_int($b)) {
                return $a === $b;
            }
            $scale = max(1.0, abs((float) $a), abs((float) $b));

            return abs((float) $a - (float) $b) <= 1e-12 * $scale;
        }

        return $a === $b;
    }
}
