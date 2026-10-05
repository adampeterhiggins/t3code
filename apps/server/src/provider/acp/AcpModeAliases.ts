/**
 * The first advertised session mode matching one of `aliases`, in alias
 * order. Exact id or name matches win over substring matches. Used by ACP
 * drivers that map T3 runtime modes onto agent-defined session modes.
 */
export function findAcpModeByAliases<Mode extends { readonly id: string; readonly name: string }>(
  modes: ReadonlyArray<Mode>,
  aliases: ReadonlyArray<string>,
): Mode | undefined {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase());
  for (const alias of normalizedAliases) {
    const exact = modes.find(
      (mode) => mode.id.toLowerCase() === alias || mode.name.toLowerCase() === alias,
    );
    if (exact) return exact;
  }
  for (const alias of normalizedAliases) {
    const partial = modes.find((mode) => normalize(`${mode.id} ${mode.name}`).includes(alias));
    if (partial) return partial;
  }
  return undefined;
}
