// Word-level differences between two versions of a line, to show exactly what tailoring changed.

export interface Piece {
  text: string;
  kind: "same" | "add" | "del";
}

/** The words of `before` and `after` in order, each kept, added or removed (longest common subsequence). */
export function wordDiff(before: string, after: string): Piece[] {
  const a = before.trim().split(/\s+/).filter(Boolean);
  const b = after.trim().split(/\s+/).filter(Boolean);
  // lcs[i][j]: length of the longest common run of a[i..] and b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const out: Piece[] = [];
  const push = (text: string, kind: Piece["kind"]) => {
    const last = out[out.length - 1];
    if (last?.kind === kind) last.text += ` ${text}`;
    else out.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push(a[i++], "same");
      j++;
    } else if (j >= b.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])) push(a[i++], "del");
    else push(b[j++], "add");
  }
  return out;
}
