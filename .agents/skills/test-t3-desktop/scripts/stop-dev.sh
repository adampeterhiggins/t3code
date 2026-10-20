#!/usr/bin/env bash
# Stop only the tree rooted at a PID recorded when this test session was spawned.
set -euo pipefail
if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: bash stop-dev.sh <pidfile>" >&2
  exit 2
fi
root=$(cat "$1")
if [[ ! "$root" =~ ^[0-9]+$ ]] || (( root <= 1 )); then
  echo "Invalid recorded PID: $root" >&2
  exit 2
fi
# Refuse a PID file pointing at this shell or any of its ancestors.
ancestor=$$
while (( ancestor > 1 )); do
  if [[ "$root" == "$ancestor" ]]; then
    echo "Refusing to stop this script or its ancestors" >&2
    exit 2
  fi
  ancestor=$(ps -o ppid= -p "$ancestor" | tr -d ' ') || break
  [[ -n "$ancestor" ]] || break
done
if ! kill -0 "$root" 2>/dev/null; then
  echo "Recorded root $root is gone; inspect retained tree records for orphans." >&2
  exit 1
fi
pids=()
starts=()
collect() {
  local pid=$1 child start known
  for known in "${pids[@]-}"; do
    if [[ "$known" == "$pid" ]]; then return 0; fi
  done
  start=$(ps -o lstart= -p "$pid") || return 0
  [[ -n "$start" ]] || return 0
  pids+=("$pid")
  starts+=("$start")
  while read -r child; do
    [[ -n "$child" ]] && collect "$child"
  done < <(pgrep -P "$pid" || true)
}
collect "$root"
if [[ -z "${pids[0]-}" ]]; then
  echo "Root exited before its tree could be captured; inspect for orphans." >&2
  exit 1
fi
printf 'Captured PID: %s\n' "${pids[@]}"
alive() {
  local index=$1 current
  kill -0 "${pids[$index]}" 2>/dev/null || return 1
  current=$(ps -o lstart= -p "${pids[$index]}") || return 1
  [[ "$current" == "${starts[$index]}" ]]
}
# Parents first: ask task runners to shut down before their watched children die.
for ((i=0; i<${#pids[@]}; i++)); do
  if alive "$i"; then kill -TERM "${pids[$i]}" 2>/dev/null || true; fi
done
for ((attempt=0; attempt<50; attempt++)); do
  remaining=0
  for ((i=0; i<${#pids[@]}; i++)); do
    if alive "$i"; then remaining=$((remaining + 1)); fi
  done
  (( remaining == 0 )) && break
  sleep 0.1
done
for ((i=0; i<${#pids[@]}; i++)); do
  if alive "$i"; then kill -KILL "${pids[$i]}" 2>/dev/null || true; fi
done
sleep 0.2
remaining=0
for ((i=0; i<${#pids[@]}; i++)); do
  if alive "$i"; then
    echo "Still alive: ${pids[$i]}" >&2
    remaining=$((remaining + 1))
  fi
done
if (( remaining > 0 )); then exit 1; fi
echo "Still alive: none (captured tree). Check every recorded dev port is free."
rm -- "$1"
