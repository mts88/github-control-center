// entries: "owner/repo" mutes one repository, "owner" or "owner/*" mutes a whole organization
export function isRepoMuted(repo: string, mutedEntries: string[]): boolean {
  const repoLowercase = repo.toLowerCase();
  const ownerLowercase = repoLowercase.split("/")[0];
  return mutedEntries.some((entry) => {
    const normalizedEntry = entry.trim().toLowerCase().replace(/\/\*$/, "");
    return normalizedEntry === repoLowercase || normalizedEntry === ownerLowercase;
  });
}
