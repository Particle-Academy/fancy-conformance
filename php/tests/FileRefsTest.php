<?php

declare(strict_types=1);

use ParticleAcademy\Conformance\Conformance;

/*
 * File references, against the SAME trees the Node, Python and Rust loaders
 * test: testdata/file-refs/, written once by scripts/build-file-ref-testdata.py,
 * with expected.json as the one statement of every verdict.
 */

function fcTestdata(): string
{
    return dirname(__DIR__, 2).'/testdata/file-refs';
}

/**
 * Every file reference in a value, depth first, document order.
 *
 * @return list<array{file: string, sha256: string}>
 */
function fcRefs(mixed $value): array
{
    if (Conformance::isFileRef($value)) {
        return [$value];
    }
    if (! is_array($value)) {
        return [];
    }
    $out = [];
    foreach ($value as $v) {
        array_push($out, ...fcRefs($v));
    }

    return $out;
}

it('gives every shared file-reference verdict, from one table', function () {
    $expected = json_decode((string) file_get_contents(fcTestdata().'/expected.json'), true, flags: JSON_THROW_ON_ERROR);
    expect(count($expected))->toBeGreaterThanOrEqual(19);

    foreach ($expected as $suite => $want) {
        if ($want === 'data') {
            $rows = Conformance::cases($suite, fcTestdata());
            expect(fcRefs(array_map(fn ($c) => [$c['input'] ?? null, $c['expected'] ?? null, $c['artifacts'] ?? null], $rows)))->toBe([], $suite);

            continue;
        }
        if ($want === 'ok') {
            $resolved = 0;
            foreach (Conformance::cases($suite, fcTestdata()) as $case) {
                foreach (fcRefs([$case['input'] ?? null, $case['expected'] ?? null, $case['artifacts'] ?? null]) as $ref) {
                    expect(hash('sha256', Conformance::fixtureBytes($suite, $ref, fcTestdata())))->toBe($ref['sha256']);
                    $resolved++;
                }
            }
            expect($resolved)->toBe(8);

            continue;
        }

        if (isset($want['load'])) {
            $message = null;
            try {
                Conformance::cases($suite, fcTestdata());
            } catch (RuntimeException $e) {
                $message = $e->getMessage();
            }
            expect($message !== null && str_contains($message, $want['load']))->toBeTrue("{$suite}: {$message}");

            continue;
        }

        $case = Conformance::cases($suite, fcTestdata())[0];
        $ref = fcRefs($case['input'])[0];
        $message = null;
        try {
            Conformance::fixtureBytes($suite, $ref, fcTestdata());
        } catch (RuntimeException $e) {
            $message = $e->getMessage();
        }
        expect($message !== null && str_contains($message, $want['bytes']))->toBeTrue("{$suite}: {$message}");
    }
});

it('names the case and the JSON pointer of a malformed reference', function () {
    expect(fn () => Conformance::cases('bad-in-expected', fcTestdata()))
        ->toThrow(RuntimeException::class, 'case "bad-in-expected/0001-x" has a malformed file reference at /expected/0: ');
    expect(fn () => Conformance::cases('bad-in-artifacts', fcTestdata()))
        ->toThrow(RuntimeException::class, 'case "bad-in-artifacts/0001-x" references fixtures/absent.bin, which does not exist');
});

it('refuses a malformed reference handed to fixtureBytes directly', function () {
    expect(fn () => Conformance::fixtureBytes('ok', ['file' => 'fixtures/../manifest.json', 'sha256' => str_repeat('0', 64)], fcTestdata()))
        ->toThrow(RuntimeException::class, 'malformed file reference');
});

it('resolves every reference in the real suites to bytes matching its sha256', function () {
    $refs = 0;
    foreach (Conformance::listSuites() as $suite) {
        if ((Conformance::manifest($suite)['caseFormat'] ?? null) !== 'table') {
            continue;
        }
        foreach (Conformance::cases($suite) as $case) {
            foreach (fcRefs([$case['input'] ?? null, $case['expected'] ?? null, $case['artifacts'] ?? null]) as $ref) {
                expect(hash('sha256', Conformance::fixtureBytes($suite, $ref)))->toBe($ref['sha256']);
                $refs++;
            }
        }
    }
    expect($refs)->toBeGreaterThan(0);
});
