// Fails when a production dependency's license is not on the AGPL-3.0-compatible allowlist (ADR 0028).
//   pnpm -r licenses list --prod --json | pnpm --filter @crm/scripts check-licenses
export {};

const ALLOWED = new Set([
  "MIT",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "MPL-2.0",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "Python-2.0",
]);

/** Evaluates simple SPDX expressions: `A OR B` passes if either does, `A AND B` only if both do. */
function allowed(expression: string): boolean {
  const expr = expression.replace(/^\((.*)\)$/, "$1").trim();
  if (expr.includes(" OR ")) return expr.split(" OR ").some((part) => allowed(part));
  if (expr.includes(" AND ")) return expr.split(" AND ").every((part) => allowed(part));
  return ALLOWED.has(expr);
}

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const report = JSON.parse(Buffer.concat(chunks).toString() || "{}") as Record<
  string,
  { name: string; versions: string[] }[]
>;
const violations = Object.entries(report)
  .filter(([license]) => !allowed(license))
  .flatMap(([license, pkgs]) => pkgs.map((p) => `${p.name}@${p.versions.join(",")}: ${license}`));
if (violations.length) {
  console.error(`Licenses not on the allowlist:\n${violations.join("\n")}`);
  process.exit(1);
}
console.log(`ok: ${Object.values(report).flat().length} production packages, all licenses allowed`);
