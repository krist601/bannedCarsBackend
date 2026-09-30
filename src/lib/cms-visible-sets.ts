import { groupCmsSets } from "./cms-set-groups";
// A hidden main set gates its whole family without overwriting division preferences.
export function visibleFilterSets<
  T extends Parameters<typeof groupCmsSets>[0][number],
>(sets: T[]): T[] {
  const visibleIds = new Set(
    groupCmsSets(sets)
      .filter((group) => group.isVisible)
      .flatMap((group) =>
        group.divisions
          .filter((division) => division.isVisible)
          .map((division) => division.id),
      ),
  );
  return sets.filter((set) => visibleIds.has(set.id));
}
