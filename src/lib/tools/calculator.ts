// Deterministic expression evaluator (shunting-yard). No eval, no Function constructor.
const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d, floor: Math.floor, ceil: Math.ceil,
  log: Math.log10, ln: Math.log, exp: Math.exp, min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3, "u-": 2.5 };

export function calculate(expr: string): number {
  if (expr.length > 500) throw new Error("Expression too long");
  const tokens = expr.toLowerCase().match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[a-z_]+|[-+*/%^(),]/g);
  if (!tokens || tokens.join("") !== expr.toLowerCase().replace(/\s+/g, "")) throw new Error("Unsupported characters in expression");
  const out: (number | string)[] = [], ops: string[] = [], argc: number[] = [];
  let prev: string | null = null;
  for (const t of tokens) {
    if (/^\d/.test(t)) { out.push(Number(t)); prev = "num"; }
    else if (t in CONSTS) { out.push(CONSTS[t]); prev = "num"; }
    else if (t in FUNCS) { ops.push(t); argc.push(1); prev = "fn"; }
    else if (t === ",") { while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop()!); argc[argc.length - 1]++; prev = ","; }
    else if (t === "(") { ops.push("("); prev = "("; }
    else if (t === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop()!);
      if (!ops.length) throw new Error("Mismatched parentheses");
      ops.pop();
      if (ops.length && ops[ops.length - 1] in FUNCS) out.push(`${ops.pop()}:${argc.pop()}`);
      prev = "num";
    } else if (t in PREC) {
      const op = t === "-" && (prev === null || prev === "(" || prev === "," || prev === "op") ? "u-" : t;
      if (op !== "u-") while (ops.length) { const top = ops[ops.length - 1]; if (top !== "(" && top in PREC && (PREC[top] > PREC[op] || (PREC[top] === PREC[op] && op !== "^" && op !== "u-"))) out.push(ops.pop()!); else break; }
      ops.push(op); prev = "op";
    } else throw new Error(`Unknown token: ${t}`);
  }
  while (ops.length) { const o = ops.pop()!; if (o === "(") throw new Error("Mismatched parentheses"); out.push(o); }
  const st: number[] = [];
  for (const x of out) {
    if (typeof x === "number") st.push(x);
    else if (x === "u-") st.push(-st.pop()!);
    else if (x.includes(":")) { const [f, n] = x.split(":"); const a = st.splice(st.length - Number(n)); st.push(FUNCS[f](...a)); }
    else { const b = st.pop()!, a = st.pop()!; if (a === undefined || b === undefined) throw new Error("Malformed expression"); st.push(x === "+" ? a + b : x === "-" ? a - b : x === "*" ? a * b : x === "/" ? a / b : x === "%" ? a % b : a ** b); }
  }
  if (st.length !== 1 || !Number.isFinite(st[0])) throw new Error("Expression did not evaluate to a finite number");
  return Math.round(st[0] * 1e12) / 1e12;
}
