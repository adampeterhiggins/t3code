export function nextForkVersion(upstreamVersion: string, previousVersion: string, date: string) {
  const stablePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stablePattern.test(upstreamVersion)) {
    throw new Error(`Expected a stable upstream version, received '${upstreamVersion}'.`);
  }
  if (!/^\d{8}$/.test(date)) {
    throw new Error(`Expected a YYYYMMDD release date, received '${date}'.`);
  }

  const fork = /^(\d+\.\d+\.\d+)-fork\.(\d{8})\.([1-9]\d*)$/.exec(previousVersion);
  const previousBase = fork?.[1] ?? previousVersion;
  if (!stablePattern.test(previousBase)) {
    throw new Error(`Cannot advance unrecognized release version '${previousVersion}'.`);
  }

  const nextParts = upstreamVersion.split(".").map(Number);
  const previousParts = previousBase.split(".").map(Number);
  const difference =
    nextParts.map((part, index) => part - previousParts[index]!).find((part) => part !== 0) ?? 0;
  // A fork suffix is a SemVer prerelease, so even today's build sorts below its stable base.
  if (difference < 0 || (difference === 0 && (fork === null || fork[2]! > date))) {
    throw new Error(
      `A fork build of ${upstreamVersion} on ${date} would downgrade ${previousVersion}.`,
    );
  }

  const sequence = fork?.[1] === upstreamVersion && fork[2] === date ? Number(fork[3]) + 1 : 1;
  if (!Number.isSafeInteger(sequence)) {
    throw new Error(`Release sequence is too large in '${previousVersion}'.`);
  }
  return `${upstreamVersion}-fork.${date}.${sequence}`;
}
