#!/usr/bin/env bash
# Stop gate: runs the lefthook pre-commit checks (biome, gitleaks) on uncommitted changes before Claude finishes.
# Exit 2 blocks the stop and hands stderr back to Claude. If Claude was already blocked once and the checks still
# fail, let it stop but warn the user, so an unfixable finding cannot loop forever.
set -uo pipefail

input=$(cat)
already_blocked=$(jq -r '.stop_hook_active // false' <<<"$input")
cd "$CLAUDE_PROJECT_DIR" || exit 0

mapfile -t changed < <({ git diff --name-only --diff-filter=ACMR HEAD; git ls-files --others --exclude-standard; } | sort -u)
[ ${#changed[@]} -eq 0 ] && exit 0

failures=""

mapfile -t code < <(printf '%s\n' "${changed[@]}" | grep -E '\.(ts|tsx|js|json)$')
if [ ${#code[@]} -gt 0 ]; then
  if ! out=$(pnpm -s biome check --no-errors-on-unmatched "${code[@]}" 2>&1); then
    failures+=$'biome check failed (fix with `pnpm biome check --write <files>`):\n'"$out"$'\n\n'
  fi
fi

leaks_input() {
  git diff HEAD
  git ls-files --others --exclude-standard -z | xargs -0 -r cat
}
if command -v gitleaks >/dev/null; then
  out=$(leaks_input | gitleaks stdin --no-banner --no-color --redact -v 2>&1)
else
  out=$(leaks_input | docker run -i --rm zricethezav/gitleaks:v8.21.2 stdin --no-banner --no-color --redact -v 2>&1)
fi
[ $? -ne 0 ] && failures+=$'gitleaks found possible secrets in uncommitted changes:\n'"$out"$'\n'

[ -z "$failures" ] && exit 0

if [ "$already_blocked" = "true" ]; then
  jq -n --arg m "Pre-commit checks still failing:
$failures" '{systemMessage: $m}'
  exit 0
fi
printf 'Pre-commit checks failed; fix them before finishing.\n\n%s' "$failures" >&2
exit 2
