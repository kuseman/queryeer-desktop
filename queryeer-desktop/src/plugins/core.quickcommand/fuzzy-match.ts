/**
 * Returns a match score for query against target, or null if query is not a
 * subsequence of target. Higher score = better match.
 *
 * Bonuses:
 *  +3 per char in a contiguous run
 *  +2 per char matched at a word boundary (space, -, _, /, .)
 *  +1 per char matched at the very start of target
 */
export function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) {
    return 0;
  }

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let qi = 0;
  let score = 0;
  let lastMatchIndex = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) {
      continue;
    }

    let bonus = 1;

    if (lastMatchIndex === ti - 1) {
      // contiguous run
      bonus += 3;
    }

    if (ti === 0) {
      bonus += 1;
    } else {
      const prev = t[ti - 1];
      if (prev === " " || prev === "-" || prev === "_" || prev === "/" || prev === ".") {
        bonus += 2;
      }
    }

    score += bonus;
    lastMatchIndex = ti;
    qi++;
  }

  return qi === q.length ? score : null;
}
