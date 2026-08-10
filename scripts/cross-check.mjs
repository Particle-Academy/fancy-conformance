#!/usr/bin/env node
/**
 * Do the two loaders agree?
 *
 * This package ships a fixture format plus two readers for it — `src/index.ts`
 * for Node and `php/src/Conformance.php` for PHP. That is itself a duplicated
 * contract, and this repository's entire argument is that a duplicated contract
 * without a shared, per-language assertion drifts.
 *
 * So the loaders are held to their own standard. Each language's own test suite
 * proves it reads the fixtures correctly, which is a claim about that language
 * only. This script is the part neither suite can make: run BOTH over the same
 * suites and require identical verdicts, case by case.
 *
 * Exits non-zero on any disagreement, on a missing toolchain, or on a suite
 * that either side declines to load. There is no skip path — a cross-check that
 * can quietly not run is the thing being guarded against.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { listSuites, runTable, suiteVersion } from "../src/index.ts";

function nodeSide() {
  const satisfies = (version, range) => {
    const trimmed = range.trim();
    if (trimmed === "*" || trimmed === "") return true;
    const pv = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
    if (!pv) return false;
    const v = [Number(pv[1]), Number(pv[2] ?? 0), Number(pv[3] ?? 0)];
    for (const clause of trimmed.split("||").map((c) => c.trim())) {
      const m = /^(\^|~|>=|>|<=|<|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(clause);
      if (!m) continue;
      const op = m[1] ?? "=";
      const t = [Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)];
      let cmp = 0;
      for (let i = 0; i < 3; i++) {
        if (v[i] !== t[i]) {
          cmp = v[i] < t[i] ? -1 : 1;
          break;
        }
      }
      const ok =
        op === ">=" ? cmp >= 0
        : op === ">" ? cmp > 0
        : op === "<=" ? cmp <= 0
        : op === "<" ? cmp < 0
        : op === "=" ? cmp === 0
        : op === "~" ? cmp >= 0 && v[0] === t[0] && v[1] === t[1]
        : op === "^" ? (t[0] === 0 ? cmp >= 0 && v[0] === 0 && v[1] === t[1] : cmp >= 0 && v[0] === t[0])
        : false;
      if (ok) return true;
    }
    return false;
  };

  const formatFloat = (v) => {
    if (!Number.isFinite(v)) return "0";
    const s = v.toFixed(14);
    if (s.includes("e") || s.includes("E")) return BigInt(v).toString();
    const trimmed = s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
    return trimmed === "-0" ? "0" : trimmed;
  };

  const roundMoney = (v) => Math.sign(v) * Math.round(Math.abs(v));

  return {
    "shared/satisfies-range": runTable(
      "shared/satisfies-range",
      (c) => satisfies(c.input.version, c.input.range),
      { language: "node" },
    ),
    "shared/decimal": runTable(
      "shared/decimal",
      (c) =>
        c.fn === "formatFloat" ? formatFloat(c.input.value)
        : c.fn === "numericStringToNumber" ? Number(c.input.value)
        : roundMoney(c.input.value),
      { language: "node" },
    ),
  };
}

const driver = join(dirname(fileURLToPath(import.meta.url)), "cross-check-driver.php");

/**
 * `php` on PATH, unless told otherwise.
 *
 * The override exists for Windows, where a PHP shipped by Herd or XAMPP is a
 * shell shim rather than an executable and cannot be spawned directly. It is
 * NOT a way to opt out: an unset or wrong value still fails the run, because
 * the alternative — quietly skipping the cross-check when PHP is awkward to
 * find — is the exact behaviour this script exists to replace.
 */
const PHP = process.env.CONFORMANCE_PHP ?? "php";

let phpRaw;
try {
  phpRaw = execFileSync(PHP, [driver], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: { ...process.env },
  });
} catch (error) {
  console.error("cross-check: PHP did not run. A missing toolchain is a FAILURE, not a skip.");
  console.error(`  tried: ${PHP}`);
  console.error("  set CONFORMANCE_PHP to an absolute path if php is a shim on this platform.");
  console.error(String(error?.message ?? error));
  process.exit(1);
}

const php = JSON.parse(phpRaw);
const node = nodeSide();

let problems = 0;

if (php.__version !== suiteVersion()) {
  console.error(`cross-check: version mismatch — node ${suiteVersion()}, php ${php.__version}`);
  problems++;
}

const nodeSuites = listSuites();
if (JSON.stringify(php.__suites) !== JSON.stringify(nodeSuites)) {
  console.error("cross-check: the two loaders discovered different suites");
  console.error(`  node: ${nodeSuites.join(", ")}`);
  console.error(`  php:  ${php.__suites.join(", ")}`);
  problems++;
}

for (const suite of Object.keys(node)) {
  const n = node[suite];
  const p = php[suite];

  if (!p) {
    console.error(`cross-check: php produced no result for ${suite}`);
    problems++;
    continue;
  }

  // Every case, by id — not just the totals. Two runs can agree on
  // "17 passed" while disagreeing about which 17.
  const nByCase = new Map(n.results.map((r) => [r.id, r.status]));
  const pByCase = new Map(p.results.map((r) => [r.id, r.status]));

  const ids = new Set([...nByCase.keys(), ...pByCase.keys()]);
  let disagreements = 0;
  for (const id of [...ids].sort()) {
    const a = nByCase.get(id);
    const b = pByCase.get(id);
    if (a !== b) {
      console.error(`cross-check: ${suite}/${id} — node says ${a ?? "(absent)"}, php says ${b ?? "(absent)"}`);
      disagreements++;
    }
  }

  if (!n.ok || !p.ok) {
    console.error(`cross-check: ${suite} did not pass on both sides`);
    problems++;
  }

  problems += disagreements;

  const total = ids.size;
  console.log(`${suite}: ${total} cases, node and php agree on ${total - disagreements}`);
}

// A run that asserted nothing must not look like a run that asserted
// everything. This is the guard the two harnesses being replaced did not have.
const asserted = Object.values(node).reduce((sum, s) => sum + s.results.length, 0);
if (asserted === 0) {
  console.error("cross-check: zero cases were compared — refusing to report success");
  process.exit(1);
}

if (problems > 0) {
  console.error(`\ncross-check FAILED with ${problems} disagreement(s)`);
  process.exit(1);
}

console.log(`\ncross-check OK — ${asserted} cases, two loaders, identical verdicts (suite ${suiteVersion()})`);
