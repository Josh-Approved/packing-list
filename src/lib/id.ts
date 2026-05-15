/**
 * Collision-proof id generator.
 *
 * The original code generated ids as `${prefix}${Date.now()}`, which collides
 * when two entities are created in the same millisecond (rapid custom-item
 * adds, duplicate-then-create, etc.). Collisions corrupt React list keys and
 * break FlatList-based drag-reorder. This combines:
 *   - a base-36 timestamp (sortable-ish, compact)
 *   - a per-session monotonic counter (uniqueness within a run, even same-ms)
 *   - a short random suffix (uniqueness across sessions / reloads)
 */

let counter = 0;

export function makeId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  const ts = Date.now().toString(36);
  const ctr = counter.toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${ts}-${ctr}-${rand}`;
}
