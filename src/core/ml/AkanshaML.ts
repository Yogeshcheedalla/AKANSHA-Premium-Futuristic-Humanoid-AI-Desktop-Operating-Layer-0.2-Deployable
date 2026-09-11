/**
 * Akansha ML Library — lightweight, deterministic, dependency-free algorithms.
 *
 * These run in the HOT PATH so they must be fast and local. No LLM calls.
 * The LLM is a reasoning engine; it is NOT the permission authority,
 * scheduler, router, or anomaly detector.
 */

/* ═══════════════ BAYESIAN PREFERENCE UPDATING ═══════════════ */

export interface BetaBelief {
  alpha: number; // pseudo-count of "yes"
  beta: number;  // pseudo-count of "no"
}

/**
 * Beta-Bernoulli belief. Starts uninformative (1,1) and sharpens with evidence.
 * Used for preference confidence: "does the user want confirmation for X?"
 */
export class BayesianBelief {
  private beliefs = new Map<string, BetaBelief>();

  init(key: string, prior: BetaBelief = { alpha: 1, beta: 1 }) {
    if (!this.beliefs.has(key)) this.beliefs.set(key, { ...prior });
    return this.beliefs.get(key)!;
  }

  /** Observe a binary outcome and update the posterior. */
  update(key: string, observed: boolean, weight = 1) {
    const b = this.init(key);
    b.alpha += (observed ? 1 : 0) * weight;
    b.beta += (observed ? 0 : 1) * weight;
  }

  /** Posterior mean — the probability the answer is "yes". */
  mean(key: string): number {
    const b = this.beliefs.get(key);
    if (!b) return 0.5;
    return b.alpha / (b.alpha + b.beta);
  }

  /**
   * Credible interval width. Narrow interval = high confidence.
   * Uses the normal approximation to Beta for speed.
   */
  uncertainty(key: string): number {
    const b = this.beliefs.get(key);
    if (!b) return 1;
    const n = b.alpha + b.beta;
    if (n <= 2) return 1;
    const p = this.mean(key);
    const sd = Math.sqrt((p * (1 - p)) / n);
    return Math.min(1, 3.92 * sd); // 95% CI width
  }

  /** Confidence in the current belief (0-1). */
  confidence(key: string): number {
    return 1 - this.uncertainty(key);
  }

  /** Total observations supporting this key. */
  evidence(key: string): number {
    const b = this.beliefs.get(key);
    return b ? b.alpha + b.beta - 2 : 0;
  }

  get(key: string): BetaBelief {
    return { ...this.init(key) };
  }

  /** Serialise for persistence. */
  toJSON(): Record<string, BetaBelief> {
    return Object.fromEntries(this.beliefs);
  }

  load(data: Record<string, BetaBelief>) {
    for (const [k, v] of Object.entries(data || {})) this.beliefs.set(k, { ...v });
  }
}

/* ═══════════════ EWMA ANOMALY DETECTION ═══════════════ */

/**
 * Exponentially Weighted Moving Average with robust deviation tracking.
 * Detects latency spikes, failure spikes, and provider degradation.
 */
export class EWMADetector {
  private mean = new Map<string, number>();
  private var = new Map<string, number>();

  constructor(private alpha = 0.2, private sigmaThreshold = 3) {}

  /** Record a value. Returns true if it is an anomaly. */
  observe(key: string, value: number): { anomaly: boolean; zScore: number; mean: number } {
    const prevMean = this.mean.get(key);
    const prevVar = this.var.get(key);

    if (prevMean === undefined) {
      this.mean.set(key, value);
      this.var.set(key, 0);
      return { anomaly: false, zScore: 0, mean: value };
    }

    const newMean = this.alpha * value + (1 - this.alpha) * prevMean;
    const newVar = this.alpha * Math.pow(value - newMean, 2) + (1 - this.alpha) * (prevVar || 0);

    this.mean.set(key, newMean);
    this.var.set(key, newVar);

    const sd = Math.sqrt(newVar) || 1e-6;
    const z = (value - newMean) / sd;

    return { anomaly: Math.abs(z) > this.sigmaThreshold, zScore: z, mean: newMean };
  }

  baseline(key: string): { mean: number; sd: number } {
    return { mean: this.mean.get(key) ?? 0, sd: Math.sqrt(this.var.get(key) ?? 0) };
  }
}

/* ═══════════════ CONTEXTUAL BANDIT (LinUCB) ═══════════════ */

/**
 * Linear Upper-Confidence-Bound contextual bandit.
 *
 * Used for MODEL SELECTION and TOOL SELECTION. Learns, per context, which
 * arm (model / tool) yields the best reward — so routing becomes empirical
 * ("this model historically works best for coding on this machine") rather
 * than heuristic ("this model sounds good").
 *
 * Disjoint model: each arm keeps its own A (d×d) and b (d) vectors.
 */
export class ContextualBandit {
  private A = new Map<string, number[][]>();
  private b = new Map<string, number[]>();
  private counts = new Map<string, number>();

  constructor(private d: number, private alpha = 0.6) {}

  private ensure(arm: string) {
    if (!this.A.has(arm)) {
      // Identity prior — uninformative start
      const A: number[][] = Array.from({ length: this.d }, (_, i) =>
        Array.from({ length: this.d }, (_, j) => (i === j ? 1 : 0))
      );
      this.A.set(arm, A);
      this.b.set(arm, new Array(this.d).fill(0));
      this.counts.set(arm, 0);
    }
  }

  private invert(m: number[][]): number[][] {
    const n = m.length;
    // Gauss-Jordan with augmented identity
    const aug = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
      [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
      const p = aug[col][col] || 1e-9;
      for (let c = 0; c < 2 * n; c++) aug[col][c] /= p;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = aug[r][col];
        if (!f) continue;
        for (let c = 0; c < 2 * n; c++) aug[r][c] -= f * aug[col][c];
      }
    }
    return aug.map((row) => row.slice(n));
  }

  private mulVec(m: number[][], v: number[]): number[] {
    return m.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
  }

  private dot(a: number[], b: number[]): number {
    return a.reduce((s, x, i) => s + x * b[i], 0);
  }

  /**
   * Score every arm for a context vector. Higher = better.
   * theta = A^-1 b (exploitation) + alpha * sqrt(x^T A^-1 x) (exploration).
   */
  score(context: number[], arms: string[]): Array<{ arm: string; score: number; trials: number }> {
    return arms
      .map((arm) => {
        this.ensure(arm);
        const A = this.A.get(arm)!;
        const b = this.b.get(arm)!;
        const Ainv = this.invert(A);
        const theta = this.mulVec(Ainv, b);
        const mean = this.dot(theta, context);
        const AinvX = this.mulVec(Ainv, context);
        const explore = this.alpha * Math.sqrt(Math.max(0, this.dot(context, AinvX)));
        return { arm, score: mean + explore, trials: this.counts.get(arm) || 0 };
      })
      .sort((a, b2) => b2.score - a.score);
  }

  /** Pick the best arm. */
  choose(context: number[], arms: string[]): string | null {
    if (arms.length === 0) return null;
    return this.score(context, arms)[0].arm;
  }

  /** Record the realised reward for a chosen arm. */
  update(arm: string, context: number[], reward: number) {
    this.ensure(arm);
    const A = this.A.get(arm)!;
    const b = this.b.get(arm)!;
    for (let i = 0; i < this.d; i++) {
      for (let j = 0; j < this.d; j++) A[i][j] += context[i] * context[j];
      b[i] += reward * context[i];
    }
    this.counts.set(arm, (this.counts.get(arm) || 0) + 1);
  }

  stats(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}

/* ═══════════════ BM25 KEYWORD RETRIEVAL ═══════════════ */

/**
 * Okapi BM25. Part of HYBRID memory retrieval — BM25 + embedding similarity
 * + recency + importance. Embeddings alone miss exact keyword matches
 * (identifiers, error codes, file names); BM25 alone misses semantics.
 */
export class BM25Index {
  private docs: Array<{ id: string; terms: string[] }> = [];
  private df = new Map<string, number>();
  private avgLen = 0;
  private k1 = 1.5;
  private b = 0.75;

  private tokenise(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length > 1);
  }

  build(docs: Array<{ id: string; content: string }>) {
    this.docs = [];
    this.df.clear();
    let total = 0;

    for (const doc of docs) {
      const terms = this.tokenise(doc.content);
      this.docs.push({ id: doc.id, terms });
      total += terms.length;
      for (const t of new Set(terms)) this.df.set(t, (this.df.get(t) || 0) + 1);
    }
    this.avgLen = this.docs.length ? total / this.docs.length : 0;
  }

  search(query: string, limit = 10): Array<{ id: string; score: number }> {
    const qTerms = this.tokenise(query);
    const N = this.docs.length;
    if (!N) return [];

    const scores = this.docs.map((doc) => {
      let score = 0;
      const len = doc.terms.length || 1;
      for (const term of qTerms) {
        const f = doc.terms.filter((t) => t === term).length;
        if (!f) continue;
        const n = this.df.get(term) || 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * (len / (this.avgLen || 1)))));
      }
      return { id: doc.id, score };
    });

    return scores.filter((s) => s.score > 0).sort((a, b2) => b2.score - a.score).slice(0, limit);
  }
}

/* ═══════════════ COSINE SIMILITY (for embeddings) ═══════════════ */

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

/* ═══════════════ LEARNING-TO-RANK (tool/capability ranking) ═══════════════ */

export interface RankableCandidate {
  id: string;
  features: Record<string, number>;
}

/**
 * Simple linear ranker with learned weights (online logistic-regression-ish
 * update via gradient descent). Ranks candidates by weighted feature sum.
 */
export class LinearRanker {
  private weights = new Map<string, number>();

  constructor(private lr = 0.05, private l2 = 0.001) {}

  score(c: RankableCandidate): number {
    let s = 0;
    for (const [k, v] of Object.entries(c.features)) {
      s += (this.weights.get(k) ?? 0) * v;
    }
    return s;
  }

  rank(candidates: RankableCandidate[]): RankableCandidate[] {
    return [...candidates].sort((a, b) => this.score(b) - this.score(a));
  }

  /** Reward a chosen candidate (positive) or penalise it (negative). */
  learn(chosen: RankableCandidate, reward: number) {
    for (const [k, v] of Object.entries(chosen.features)) {
      const w = this.weights.get(k) ?? 0;
      // Gradient step toward the reward, with L2 shrinkage
      const updated = w + this.lr * (reward * v - this.l2 * w);
      this.weights.set(k, updated);
    }
  }

  getWeights(): Record<string, number> {
    return Object.fromEntries(this.weights);
  }
}

/* ═══════════════ UTILITY ═══════════════ */

export function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

export function normaliseScores<T extends { score: number }>(items: T[]): T[] {
  if (items.length === 0) return items;
  const max = Math.max(...items.map((i) => i.score));
  const min = Math.min(...items.map((i) => i.score));
  const range = max - min || 1;
  return items.map((i) => ({ ...i, score: (i.score - min) / range }));
}
