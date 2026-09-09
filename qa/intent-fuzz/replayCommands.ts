/**
 * replayCommands.ts — the `fc.commands` half of the replay contract.
 *
 * WHY THIS EXISTS (app-local, NOT part of the synced kit). The kit's
 * `replay.ts` re-runs a crystallized fixture with `fc.assert(build(), { seed,
 * path })`. That is enough for a plain `fc.property`, but every intent-fuzz
 * model is built on `fc.commands`, and fast-check cannot walk a multi-segment
 * shrink path for a commands value unless the SAME run is given the commands'
 * own `replayPath` (the `/*replayPath="…"*\/` token fast-check prints next to
 * the counterexample and the harness stores inside the fixture's `story`).
 * Without it every such fixture throws `Unable to replay, got wrong path=…`
 * — which reads exactly like "the arbitraries moved under it", and is why
 * packing-list's 2026-09-06 fixture was written off as unreproducible and left
 * uncommitted. Proven 2026-09-09: the same seed + path + `replayPath` replays
 * cleanly, and goes red again on the pre-fix code.
 *
 * This lives in its own file, and is not one of the paths `sync.mjs
 * intent-fuzz` writes, so the app carries the fix without putting a synced
 * file out of date with the factory. FACTORY FOLLOW-UP: fold this into
 * `templates/qa/intent-fuzz/replay.ts` (pass each fixture's replayPath to the
 * builder) and this file can go away — it affects every app on the kit, not
 * just this one.
 *
 * Same test shape as the kit's replayRegressions: one `it(...)` per checked-in
 * fixture, same describe/it names, a failing test rather than a silent skip
 * when a fixture names a model nobody registered.
 */

import fc from 'fast-check';

interface ReplayCore {
  listRegressions(appRoot?: string): Array<{
    _file: string; _error?: string; model?: string; seed?: number; path?: string; story?: string; message?: string;
  }>;
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const core = require('./harnessCore.cjs') as ReplayCore;

/** A model's property builder. Takes the commands' replayPath so a shrunk
 *  fixture can be walked; called with `undefined` by the live fuzzer. */
export type CommandPropertyBuilder = (replayPath?: string) => fc.IPropertyWithHooks<unknown>;

export interface ReplayConfig {
  models: Record<string, CommandPropertyBuilder>;
  appRoot?: string;
}

/** Pull fast-check's own `/*replayPath="…"*\/` token out of a stored story. */
export function replayPathOf(story: string | undefined): string | undefined {
  if (!story) return undefined;
  const m = /replayPath="([^"]*)"/.exec(story);
  return m ? m[1] : undefined;
}

export function replayCommandRegressions(config: ReplayConfig): void {
  const regs = core.listRegressions(config.appRoot);

  describe('intent-fuzz regressions (crystallized failures, replayed forever)', () => {
    if (regs.length === 0) {
      it('no regressions checked in yet', () => {
        expect(true).toBe(true);
      });
      return;
    }

    for (const reg of regs) {
      const label = reg.story ? `${reg._file} — ${firstLine(reg.story)}` : reg._file;

      if (reg._error) {
        it(`fixture ${reg._file} is unreadable`, () => {
          throw new Error(`corrupt regression fixture ${reg._file}: ${reg._error}`);
        });
        continue;
      }

      const build = reg.model ? config.models[reg.model] : undefined;
      if (!build) {
        it(`replays ${label}`, () => {
          throw new Error(
            `regression ${reg._file} references model "${reg.model}" not passed to replayCommandRegressions — ` +
              `add its buildProperty to \`models\`.`
          );
        });
        continue;
      }

      it(`replays ${label}`, () => {
        // Re-run the EXACT minimized failing case. Throws if the bug regressed.
        fc.assert(build(replayPathOf(reg.story)), {
          seed: reg.seed as number,
          path: reg.path as string,
          numRuns: 1,
          endOnFailure: true,
        });
      });
    }
  });
}

function firstLine(s: string): string {
  return String(s).split('\n')[0].slice(0, 80);
}
