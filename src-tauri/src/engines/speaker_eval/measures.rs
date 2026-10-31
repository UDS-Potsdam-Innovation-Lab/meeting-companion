//! Accuracy measures for speaker detection, on a 10 ms grid:
//!
//! - Diarization error rate (DER) = (missed speech + false alarm + speaker confusion) / reference
//!   speech, as in NIST md-eval: per frame, with `R` reference and `H` hypothesis speakers active and
//!   `C` of the hypothesis speakers mapped to an active reference speaker, missed = max(0, R − H),
//!   false alarm = max(0, H − R), confusion = min(R, H) − C. Overlapped speech counts once per speaker.
//!   Frames within the collar of a reference turn's start or end are not scored.
//! - The mapping of hypothesis voices to reference speakers is one-to-one and maximises the time they
//!   share (Hungarian method); unmapped voices are confusion where reference speech is.
//! - Line accuracy: the share of lines (hypothesis segments) whose voice maps to the reference speaker
//!   who speaks most of the line. Lines without reference speech are left out; a line without a voice
//!   is wrong.
//!
//! Test-only.

use std::collections::BTreeMap;

pub const FRAME_MS: u64 = 10;

/// A labelled stretch of time: a reference turn (`label` = speaker) or a hypothesis line
/// (`label` = voice, `None` for a line without one).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Span {
    pub start_ms: u64,
    pub end_ms: u64,
    pub label: Option<String>,
}

impl Span {
    pub fn new(start_ms: u64, end_ms: u64, label: Option<&str>) -> Self {
        Self {
            start_ms,
            end_ms,
            label: label.map(str::to_owned),
        }
    }
}

/// How one line was judged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LineResult {
    /// The reference speaker who speaks most of the line.
    pub reference: Option<String>,
    pub voice: Option<String>,
    /// The reference speaker the line's voice maps to.
    pub mapped: Option<String>,
    pub correct: bool,
    /// More than one reference speaker speaks during the line.
    pub mixed: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Measures {
    /// Scored reference speech (speaker-time), ms.
    pub reference_ms: u64,
    pub missed_ms: u64,
    pub false_alarm_ms: u64,
    pub confusion_ms: u64,
    /// Voice → reference speaker.
    pub mapping: BTreeMap<String, String>,
    pub lines: Vec<LineResult>,
    /// Distinct voices in the hypothesis and speakers in the reference.
    pub voices: usize,
    pub speakers: usize,
}

impl Measures {
    fn share(&self, ms: u64) -> f64 {
        if self.reference_ms == 0 {
            0.0
        } else {
            ms as f64 / self.reference_ms as f64
        }
    }
    pub fn der(&self) -> f64 {
        self.share(self.missed_ms + self.false_alarm_ms + self.confusion_ms)
    }
    pub fn missed(&self) -> f64 {
        self.share(self.missed_ms)
    }
    pub fn false_alarm(&self) -> f64 {
        self.share(self.false_alarm_ms)
    }
    pub fn confusion(&self) -> f64 {
        self.share(self.confusion_ms)
    }
    /// Correct lines among the lines with reference speech (1.0 when there are none).
    pub fn line_accuracy(&self) -> f64 {
        let scored: Vec<&LineResult> = self
            .lines
            .iter()
            .filter(|l| l.reference.is_some())
            .collect();
        if scored.is_empty() {
            return 1.0;
        }
        scored.iter().filter(|l| l.correct).count() as f64 / scored.len() as f64
    }
}

/// Options of [`evaluate`].
#[derive(Debug, Clone, Default)]
pub struct Scoring {
    /// No-score zone on both sides of every reference boundary, ms.
    pub collar_ms: u64,
    /// Score only these stretches (all of the time when `None`).
    pub only: Option<Vec<(u64, u64)>>,
}

fn frames(ms: u64) -> usize {
    (ms / FRAME_MS) as usize
}

/// Labels active per frame.
fn grid(spans: &[Span], len: usize, index: &BTreeMap<String, usize>) -> Vec<Vec<usize>> {
    let mut g = vec![Vec::new(); len];
    for s in spans {
        let Some(label) = &s.label else { continue };
        let i = index[label];
        for f in g
            .iter_mut()
            .take(frames(s.end_ms).min(len))
            .skip(frames(s.start_ms))
        {
            if !f.contains(&i) {
                f.push(i);
            }
        }
    }
    g
}

fn labels(spans: &[Span]) -> BTreeMap<String, usize> {
    let mut names: Vec<&String> = spans.iter().filter_map(|s| s.label.as_ref()).collect();
    names.sort();
    names.dedup();
    names
        .into_iter()
        .enumerate()
        .map(|(i, n)| (n.clone(), i))
        .collect()
}

/// The one-to-one assignment of rows to columns that maximises the summed weight (Hungarian method,
/// O(n³)). Returns, per row, its column or `None`.
pub fn best_assignment(weights: &[Vec<i64>]) -> Vec<Option<usize>> {
    let rows = weights.len();
    let cols = weights.iter().map(Vec::len).max().unwrap_or(0);
    let n = rows.max(cols);
    if n == 0 {
        return Vec::new();
    }
    let max = weights.iter().flatten().copied().max().unwrap_or(0);
    // Minimise max − w on a square matrix (padding weighs 0).
    let cost =
        |i: usize, j: usize| max - weights.get(i).and_then(|r| r.get(j)).copied().unwrap_or(0);
    let inf = i64::MAX / 4;
    let (mut u, mut v) = (vec![0i64; n + 1], vec![0i64; n + 1]);
    let mut p = vec![0usize; n + 1]; // p[j]: row (1-based) assigned to column j
    let mut way = vec![0usize; n + 1];
    for i in 1..=n {
        p[0] = i;
        let mut j0 = 0;
        let mut minv = vec![inf; n + 1];
        let mut used = vec![false; n + 1];
        loop {
            used[j0] = true;
            let i0 = p[j0];
            let mut delta = inf;
            let mut j1 = 0;
            for j in 1..=n {
                if !used[j] {
                    let cur = cost(i0 - 1, j - 1) - u[i0] - v[j];
                    if cur < minv[j] {
                        minv[j] = cur;
                        way[j] = j0;
                    }
                    if minv[j] < delta {
                        delta = minv[j];
                        j1 = j;
                    }
                }
            }
            for j in 0..=n {
                if used[j] {
                    u[p[j]] += delta;
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }
            j0 = j1;
            if p[j0] == 0 {
                break;
            }
        }
        loop {
            let j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
            if j0 == 0 {
                break;
            }
        }
    }
    let mut out = vec![None; rows];
    for (j, &i) in p.iter().enumerate().skip(1) {
        if i >= 1 && i <= rows && j <= cols {
            out[i - 1] = Some(j - 1);
        }
    }
    out
}

/// Scores `hypothesis` lines against `reference` turns.
pub fn evaluate(reference: &[Span], hypothesis: &[Span], scoring: &Scoring) -> Measures {
    let end = reference
        .iter()
        .chain(hypothesis)
        .map(|s| s.end_ms)
        .max()
        .unwrap_or(0);
    let len = frames(end) + 1;
    let ref_ix = labels(reference);
    let hyp_ix = labels(hypothesis);
    let r = grid(reference, len, &ref_ix);
    let h = grid(hypothesis, len, &hyp_ix);

    let mut scored = vec![scoring.only.is_none(); len];
    if let Some(only) = &scoring.only {
        for (a, b) in only {
            for f in scored.iter_mut().take(frames(*b).min(len)).skip(frames(*a)) {
                *f = true;
            }
        }
    }
    let collar = frames(scoring.collar_ms);
    if collar > 0 {
        for s in reference {
            for edge in [frames(s.start_ms), frames(s.end_ms)] {
                for f in scored
                    .iter_mut()
                    .take((edge + collar).min(len))
                    .skip(edge.saturating_sub(collar))
                {
                    *f = false;
                }
            }
        }
    }

    // Shared time of every voice with every speaker, over scored frames.
    let mut shared = vec![vec![0i64; ref_ix.len()]; hyp_ix.len()];
    for f in (0..len).filter(|f| scored[*f]) {
        for hv in &h[f] {
            for rs in &r[f] {
                shared[*hv][*rs] += 1;
            }
        }
    }
    let assignment = best_assignment(&shared);
    let ref_names: Vec<&String> = ref_ix.keys().collect();
    let hyp_names: Vec<&String> = hyp_ix.keys().collect();
    let map: Vec<Option<usize>> = assignment
        .iter()
        .enumerate()
        .map(|(hv, rs)| rs.filter(|rs| shared[hv][*rs] > 0))
        .collect();

    let (mut total, mut missed, mut fa, mut conf) = (0u64, 0u64, 0u64, 0u64);
    for f in (0..len).filter(|f| scored[*f]) {
        let (nr, nh) = (r[f].len() as u64, h[f].len() as u64);
        let correct = h[f]
            .iter()
            .filter(|hv| map[**hv].is_some_and(|rs| r[f].contains(&rs)))
            .count() as u64;
        total += nr;
        missed += nr.saturating_sub(nh);
        fa += nh.saturating_sub(nr);
        conf += nr.min(nh) - correct.min(nr.min(nh));
    }

    let mapping: BTreeMap<String, String> = map
        .iter()
        .enumerate()
        .filter_map(|(hv, rs)| rs.map(|rs| (hyp_names[hv].clone(), ref_names[rs].clone())))
        .collect();
    let lines = hypothesis
        .iter()
        .map(|line| {
            let mut by_speaker = vec![0u64; ref_ix.len()];
            for frame in r
                .iter()
                .take(frames(line.end_ms).min(len))
                .skip(frames(line.start_ms))
            {
                for rs in frame {
                    by_speaker[*rs] += 1;
                }
            }
            let speaking = by_speaker.iter().filter(|n| **n > 0).count();
            // Most time wins; on a tie the first speaker by name.
            let reference = by_speaker
                .iter()
                .enumerate()
                .filter(|(_, n)| **n > 0)
                .max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(&a.0)))
                .map(|(rs, _)| ref_names[rs].clone());
            let mapped = line.label.as_ref().and_then(|l| mapping.get(l).cloned());
            LineResult {
                correct: reference.is_some() && mapped == reference,
                reference,
                voice: line.label.clone(),
                mapped,
                mixed: speaking > 1,
            }
        })
        .collect();

    Measures {
        reference_ms: total * FRAME_MS,
        missed_ms: missed * FRAME_MS,
        false_alarm_ms: fa * FRAME_MS,
        confusion_ms: conf * FRAME_MS,
        mapping,
        lines,
        voices: hyp_ix.len(),
        speakers: ref_ix.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(a: u64, b: u64, label: &str) -> Span {
        Span::new(a, b, Some(label))
    }

    fn plain() -> Scoring {
        Scoring::default()
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn the_assignment_is_optimal_where_greedy_is_not() {
        // Greedy would take x→a (5) and leave y→b (0): 5. Optimal: x→b + y→a = 8.
        assert_eq!(
            best_assignment(&[vec![5, 4], vec![4, 0]]),
            [Some(1), Some(0)]
        );
        // More rows than columns: one row stays unassigned.
        let a = best_assignment(&[vec![1], vec![7], vec![3]]);
        assert_eq!(a, [None, Some(0), None]);
        // More columns than rows.
        assert_eq!(best_assignment(&[vec![0, 2, 9]]), [Some(2)]);
        assert!(best_assignment(&[]).is_empty());
    }

    /// A permuted labelling: the hypothesis calls A "B" and B "A"; the mapping undoes it.
    #[test]
    fn a_permuted_labelling_has_no_confusion() {
        let reference = [s(0, 1_000, "A"), s(1_000, 2_000, "B")];
        let hyp = [s(0, 1_000, "B"), s(1_000, 2_000, "A")];
        let m = evaluate(&reference, &hyp, &plain());
        assert_eq!(m.reference_ms, 2_000);
        assert_eq!((m.missed_ms, m.false_alarm_ms, m.confusion_ms), (0, 0, 0));
        assert_eq!(m.der(), 0.0);
        assert_eq!(m.mapping["B"], "A");
        assert_eq!(m.mapping["A"], "B");
        assert_eq!(m.line_accuracy(), 1.0);
    }

    #[test]
    fn a_permuted_labelling_with_one_wrong_line() {
        let reference = [s(0, 2_000, "A"), s(2_000, 4_000, "B")];
        let hyp = [s(0, 2_000, "B"), s(2_000, 3_000, "A"), s(3_000, 4_000, "B")];
        let m = evaluate(&reference, &hyp, &plain());
        // B shares 2 s with A and 1 s with B; A shares 1 s with B: B→A, A→B (3 s) beats B→B (1 s).
        assert_eq!(m.mapping["B"], "A");
        assert_eq!(m.confusion_ms, 1_000);
        assert!(close(m.der(), 0.25));
        assert!(close(m.line_accuracy(), 2.0 / 3.0));
        assert!(!m.lines[2].correct);
        assert_eq!(m.lines[2].reference.as_deref(), Some("B"));
        assert_eq!(m.lines[2].mapped.as_deref(), Some("A"));
    }

    /// An extra hypothesis voice is not mapped: its time is confusion.
    #[test]
    fn an_extra_voice_is_confusion() {
        let reference = [s(0, 3_000, "A")];
        let hyp = [s(0, 1_000, "X"), s(1_000, 2_000, "Y"), s(2_000, 3_000, "X")];
        let m = evaluate(&reference, &hyp, &plain());
        assert_eq!(m.mapping.len(), 1);
        assert_eq!(m.mapping["X"], "A");
        assert_eq!(m.confusion_ms, 1_000);
        assert!(close(m.der(), 1.0 / 3.0));
        assert!(close(m.confusion(), 1.0 / 3.0));
        assert!(close(m.line_accuracy(), 2.0 / 3.0));
        assert_eq!((m.voices, m.speakers), (2, 1));
    }

    /// A line without a voice is missed speech and a wrong line.
    #[test]
    fn unlabelled_lines_are_missed_speech() {
        let reference = [s(0, 2_000, "A"), s(2_000, 4_000, "B")];
        let hyp = [
            s(0, 2_000, "X"),
            Span::new(2_000, 3_000, None),
            s(3_000, 4_000, "Y"),
        ];
        let m = evaluate(&reference, &hyp, &plain());
        assert_eq!(
            (m.missed_ms, m.false_alarm_ms, m.confusion_ms),
            (1_000, 0, 0)
        );
        assert!(close(m.missed(), 0.25));
        assert!(close(m.der(), 0.25));
        assert!(close(m.line_accuracy(), 2.0 / 3.0));
        assert!(!m.lines[1].correct);
    }

    /// A voice where nobody speaks is a false alarm; a line with no reference speech is not scored.
    #[test]
    fn a_voice_over_silence_is_a_false_alarm() {
        let reference = [s(0, 1_000, "A")];
        let hyp = [s(0, 1_500, "X"), s(3_000, 4_000, "Y")];
        let m = evaluate(&reference, &hyp, &plain());
        assert_eq!(m.false_alarm_ms, 1_500);
        assert!(close(m.false_alarm(), 1.5));
        assert!(close(m.der(), 1.5));
        assert_eq!(m.lines[1].reference, None);
        assert_eq!(m.line_accuracy(), 1.0);
    }

    /// Overlapped speech counts once per speaker; one voice covers only one of them.
    #[test]
    fn overlapped_speech_counts_per_speaker() {
        let reference = [s(0, 2_000, "A"), s(1_000, 3_000, "B")];
        let hyp = [s(0, 1_500, "X"), s(1_500, 3_000, "Y")];
        let m = evaluate(&reference, &hyp, &plain());
        assert_eq!(m.reference_ms, 4_000);
        assert_eq!(
            (m.missed_ms, m.false_alarm_ms, m.confusion_ms),
            (1_000, 0, 0)
        );
        assert!(close(m.der(), 0.25));
        assert_eq!(m.line_accuracy(), 1.0);
        assert!(m.lines.iter().all(|l| l.mixed));
    }

    /// A 0.25 s collar forgives a late change of speaker, but not one outside it.
    #[test]
    fn the_collar_skips_250_ms_around_every_reference_boundary() {
        let reference = [s(0, 2_000, "A"), s(2_000, 4_000, "B")];
        let late = [s(0, 2_200, "X"), s(2_200, 4_000, "Y")];
        let m = evaluate(&reference, &late, &plain());
        assert_eq!(m.confusion_ms, 200);
        assert!(close(m.der(), 0.05));
        let collar = Scoring {
            collar_ms: 250,
            only: None,
        };
        let m = evaluate(&reference, &late, &collar);
        assert_eq!(m.reference_ms, 3_000);
        assert_eq!(m.der(), 0.0);
        let later = [s(0, 2_400, "X"), s(2_400, 4_000, "Y")];
        let m = evaluate(&reference, &later, &collar);
        assert_eq!(m.confusion_ms, 150);
        assert!(close(m.der(), 0.05));
    }

    #[test]
    fn only_the_given_stretches_are_scored() {
        let reference = [s(0, 2_000, "A"), s(2_000, 4_000, "B")];
        let hyp = [s(0, 3_000, "X"), s(3_000, 4_000, "Y")];
        let m = evaluate(
            &reference,
            &hyp,
            &Scoring {
                collar_ms: 0,
                only: Some(vec![(0, 1_000), (3_000, 4_000)]),
            },
        );
        assert_eq!(m.reference_ms, 2_000);
        assert_eq!(m.confusion_ms, 0);
    }
}
