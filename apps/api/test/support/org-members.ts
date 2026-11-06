/**
 * Who belongs to which GitHub org, as the GitHub fakes answer it. A record maps each org to its
 * members, so a test can say "octocat is in `acme` and not in `globex`". A plain list of logins
 * is shorthand for "these logins belong to every org", for tests that are not about tenancy.
 * Orgs and logins compare case-insensitively, as they do on GitHub.
 */
export type OrgMembers = readonly string[] | Readonly<Record<string, readonly string[]>>;

function isEveryOrg(members: OrgMembers): members is readonly string[] {
  return Array.isArray(members);
}

/** Whether `login` is a member of `org` according to `members`. */
export function isMemberOf(members: OrgMembers, org: string, login: string): boolean {
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
  const logins = isEveryOrg(members)
    ? members
    : (Object.entries(members).find(([name]) => same(name, org))?.[1] ?? []);
  return logins.some((member) => same(member, login));
}
