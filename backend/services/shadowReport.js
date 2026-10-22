/**
 * Shadow-mode report (decision D-56): does the model beat the rules on real answers?
 *
 * Pure: it takes saved Session documents and scores two guesses stored on each, the rules'
 * (`workType`, what people saw) and the model's (`modelGuess`, saved but never shown), against the
 * person's own answer. Only picker and blind answers count: an answer given while the rules' guess was
 * on screen leans towards that guess, so it would flatter the rules (ML plan M4).
 *
 * The verdict uses the same gate as ml/train_work_type.py: the model's macro-F1 at least 0.05 above
 * the rules', and no work type's recall more than 0.05 below the rules'. Before that, there must be
 * enough answers for the numbers to mean anything.
 */

const { WORK_TYPES } = require('./workType');
const { trainingLabel } = require('./sessionSnapshot');

const MIN_LABELS = 150;   // fewer and macro-F1 moves by ±0.1 from luck alone
const MIN_PEOPLE = 10;    // so one person's habits cannot decide it
const MIN_PER_TYPE = 10;  // a recall from fewer than 10 answers is not a number
const MARGIN = 0.05;

const round3 = (x) => Math.round(x * 1000) / 1000;

/** Accuracy, macro-F1 over the five types, and recall per type ("not sure" is simply wrong). */
function score(pairs) {
  const correct = pairs.filter(([truth, guess]) => truth === guess).length;
  const recall = {};
  let f1Sum = 0;
  for (const t of WORK_TYPES) {
    const tp = pairs.filter(([truth, guess]) => truth === t && guess === t).length;
    const actual = pairs.filter(([truth]) => truth === t).length;
    const predicted = pairs.filter(([, guess]) => guess === t).length;
    const r = actual ? tp / actual : 0;
    const p = predicted ? tp / predicted : 0;
    recall[t] = round3(r);
    f1Sum += p + r > 0 ? (2 * p * r) / (p + r) : 0;
  }
  return { accuracy: pairs.length ? round3(correct / pairs.length) : 0, macroF1: round3(f1Sum / WORK_TYPES.length), recall };
}

function shadowReport(docs) {
  const skipped = { shown: 0, noModelGuess: 0, unlabelled: 0 };
  const scored = [];
  for (const d of docs) {
    const label = trainingLabel(d);
    if (!label) { skipped.unlabelled++; continue; }
    if (label.source === 'shown') { skipped.shown++; continue; }
    if (!d.modelGuess || !d.modelGuess.type) { skipped.noModelGuess++; continue; }
    scored.push({ user: String(d.userId), truth: label.type, rules: d.workType && d.workType.type, model: d.modelGuess.type,
      version: d.modelGuess.modelVersion });
  }

  const rules = score(scored.map((s) => [s.truth, s.rules]));
  const model = score(scored.map((s) => [s.truth, s.model]));
  const people = new Set(scored.map((s) => s.user)).size;
  const perType = Object.fromEntries(WORK_TYPES.map((t) => [t, scored.filter((s) => s.truth === t).length]));

  const reasons = [];
  if (scored.length < MIN_LABELS) reasons.push(`${scored.length} answers; need ${MIN_LABELS}`);
  if (people < MIN_PEOPLE) reasons.push(`${people} people; need ${MIN_PEOPLE}`);
  for (const t of WORK_TYPES) if (perType[t] < MIN_PER_TYPE) reasons.push(`${perType[t]} ${t} answers; need ${MIN_PER_TYPE}`);

  let verdict = 'not_enough_labels';
  if (!reasons.length) {
    if (round3(model.macroF1 - rules.macroF1) < MARGIN) reasons.push(`model macro-F1 ${model.macroF1} is not ${MARGIN} above the rules' ${rules.macroF1}`);
    for (const t of WORK_TYPES) {
      if (round3(rules.recall[t] - model.recall[t]) > MARGIN) reasons.push(`${t}: model recall ${model.recall[t]} is more than ${MARGIN} below the rules' ${rules.recall[t]}`);
    }
    verdict = reasons.length ? 'keep_rules' : 'switch_on';
    if (!reasons.length) reasons.push(`model macro-F1 ${model.macroF1} vs rules ${rules.macroF1}, no type more than ${MARGIN} worse`);
  }

  return {
    verdict, reasons, labels: scored.length, people, perType, skipped,
    modelVersions: [...new Set(scored.map((s) => s.version).filter(Boolean))],
    model, rules,
  };
}

module.exports = { shadowReport, score, MIN_LABELS, MIN_PEOPLE, MIN_PER_TYPE, MARGIN };
