import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import chatbot from "../.test-build/lib/chatbot.js";
import data from "../.test-build/data/qaData.js";

const { getBotResponse, normalizeText } = chatbot;
const { qaData } = data;
const source = JSON.parse(readFileSync(new URL("../src/data/qaData.json", import.meta.url), "utf8"));

test("JSON is the only knowledge source and IDs are unique", () => {
  assert.deepEqual(qaData, source);
  assert.equal(new Set(qaData.map((item) => item.id)).size, qaData.length);
  for (const law of ["KCL", "KVL"]) {
    assert.deepEqual(qaData.filter((item) => item.guideStep && item.category === `${law} Procedure`).map((item) => item.guideStep.order).sort((a, b) => a - b), Array.from({ length: 12 }, (_, index) => index + 1));
  }
  assert.equal(qaData.filter((item) => item.quiz).length, 60);
});

test("every stored question is reachable with its experiment selected", () => {
  for (const item of qaData) {
    const experiment = /KVL/.test(item.category + item.question) ? "KVL" : "KCL";
    const response = getBotResponse(item.quiz ? `${item.quiz.stage}test question ${item.quiz.number}` : item.question, { experiment });
    // Next-step guidance intentionally depends on conversation progress.
    if (item.id === 167) continue;
    assert.equal(response.matched, true, item.question);
  }
});

test("normalization preserves circuit subscripts and handles curly apostrophes", () => {
  assert.equal(normalizeText("Kirchhoff’s Current Law"), normalizeText("Kirchhoff's Current Law"));
  assert.equal(normalizeText("I₁ = I₂ + I₃"), normalizeText("I1 = I2 + I3"));
  for (const input of ["KCL", "kCl", "What is KCL?"]) assert.match(getBotResponse(input).answer, /current entering/i);
});

test("walkthrough questions and alternate wording find relevant answers", () => {
  const examples = [
    ["DC ammeters", /branch currents/],
    ["What is the ammeter rating?", /0–10 mA/],
    ["ammeter raing", /0–10 mA/],
    ["What is the power supply rating?", /15 V DC/],
    ["Resistance range", /1–5 kΩ/],
    ["How to set resistances?", /resistance sliders/],
    ["auto conect", /connections automatically/],
    ["How can I delete a wrong wire?", /label number/],
    ["plot button", /graph/],
    ["print", /print the simulation/],
    ["observation table", /I1, I2, and I3/],
    ["generate report", /graph, user-calculated results/],
  ];
  for (const [input, expected] of examples) {
    const response = getBotResponse(input, { experiment: "KCL" });
    assert.equal(response.matched, true, input);
    assert.match(response.answer, expected, input);
  }
});

test("follow-up ratings refer to the last instrument", () => {
  const first = getBotResponse("DC ammeters", { experiment: "KCL" });
  const second = getBotResponse("What is its range?", first.context);
  assert.match(second.answer, /0–10 mA/);
  const supply = getBotResponse("Regulated DC Power Supply", second.context);
  assert.match(getBotResponse("and its rating?", supply.context).answer, /15 V DC/);
});

test("experiment context keeps current and voltage tables separate", () => {
  const voltmeters = getBotResponse("DC voltmeters", { experiment: "KCL" });
  assert.equal(voltmeters.context.experiment, "KVL");
  assert.match(voltmeters.answer, /voltage drop/);
  assert.match(getBotResponse("what is the aim of this experiment", { experiment: "KCL" }).answer, /total current entering/);
  assert.match(getBotResponse("observation table", { experiment: "KCL" }).answer, /I1, I2, and I3/);
  assert.match(getBotResponse("What is the Observation Table used for?", { experiment: "KVL" }).answer, /V1, V2, and V3/);
  const first = getBotResponse("What is the aim of the KCL experiment?", { experiment: "KCL" });
  const second = getBotResponse("and KVL?", first.context);
  assert.equal(second.context.experiment, "KVL");
  assert.match(second.answer, /voltage drops/);
});

test("natural troubleshooting wording finds relevant instructions", () => {
  assert.match(getBotResponse("why is add button disabled", { experiment: "KCL" }).answer, /reading|observation/i);
  assert.match(getBotResponse("my ammeter is not showing current", { experiment: "KCL" }).answer, /voltage|supply|connection/i);
});

test("walkthrough progresses, repeats, goes back, and survives side questions", () => {
  let response = getBotResponse("Start the KCL walkthrough");
  assert.match(response.answer, /Step 1 of 12/);
  response = getBotResponse("next", response.context);
  assert.match(response.answer, /Step 2 of 12/);
  response = getBotResponse("What is KCL?", response.context);
  response = getBotResponse("next", response.context);
  assert.match(response.answer, /Step 3 of 12/);
  response = getBotResponse("previous step", response.context);
  assert.equal(response.context.walkthroughStep, 2);
  response = getBotResponse("repeat step", response.context);
  assert.equal(response.context.walkthroughStep, 2);
  for (let order = 3; order <= 12; order++) {
    response = getBotResponse("next", response.context);
    assert.equal(response.context.walkthroughStep, order);
  }
  assert.match(getBotResponse("next", response.context).answer, /end of the KCL procedure/);
  assert.equal(getBotResponse("What is KVL?", response.context).context.walkthroughStep, undefined);
  assert.match(getBotResponse("Start the KCL walkthrough", response.context).answer, /Step 1 of 12/);
});

test("vague and unrelated questions do not produce confident unrelated answers", () => {
  for (const input of ["", "???", "what is its rating", "rating", "pizza delivery", "What is the weather today?", "KCL banana spaceship recipe"]) {
    assert.equal(getBotResponse(input).matched, false, input);
  }
  const differentNumbers = getBotResponse("If I2 is 4 mA and I3 is 6 mA, what should I1 be?");
  assert.doesNotMatch(differentNumbers.answer, /8 mA/);
});

test("answers do not return suggestion menus or option letters", () => {
  for (const input of ["DC ammeters", "hello", "pizza delivery", "pretest question 1"]) {
    const response = getBotResponse(input);
    assert.equal(response.suggestions, undefined);
    assert.doesNotMatch(response.answer, /choose.*question|question.*below|From the lab guide|^[A-D]\./im);
  }
});

test("both complete procedures and their individual steps match the supplied order", () => {
  const kcl = getBotResponse("KCL procedure");
  assert.match(kcl.answer, /up to five readings/);
  assert.match(kcl.answer, /8\. Click PLOT/);
  assert.match(kcl.answer, /at least one successful verification/);
  const kvl = getBotResponse("KVL procedure", kcl.context);
  assert.match(kvl.answer, /all five observations/);
  assert.match(kvl.answer, /8\. Click CALCULATE/);
  assert.match(kvl.answer, /voltmeters/);
  const both = getBotResponse("experimental procedure");
  assert.match(both.answer, /KCL Procedure/);
  assert.match(both.answer, /KVL Procedure/);
  const follow = getBotResponse("and KVL?", kcl.context);
  assert.match(follow.answer, /CALCULATE/);
  assert.match(getBotResponse("KVL step 8").answer, /CALCULATE/);
  assert.match(getBotResponse("step 9", kvl.context).answer, /click Verify/);
  const guide = getBotResponse("Start KVL walkthrough");
  assert.match(guide.answer, /KVL — Step 1 of 12/);
  assert.match(getBotResponse("next", guide.context).answer, /automatically makes and verifies/);
  assert.match(getBotResponse("Does AUTO CONNECT also verify the connections?").answer, /automatically makes and verifies/);
});

test("quiz answers are exact and diagram-dependent questions require identity", () => {
  assert.equal(getBotResponse("pre-test question 1").answer, "Charge");
  assert.equal(getBotResponse("pre-test question 1", { experiment: "KVL" }).context.experiment, "KCL");
  assert.equal(getBotResponse("posttest 12").answer, "0.1 V");
  assert.equal(getBotResponse("Kirchhoff's Current Law is based on the conservation of:\nA. Energy\nB. Charge\nC. Power\nD. Resistance").answer, "Charge");
  assert.equal(getBotResponse("The current through a series circuit is:", { experiment: "KVL" }).answer, "Same throughout the circuit");
  assert.equal(getBotResponse("Find the value of the current I (in Amperes) is ______.").matched, false);
  assert.equal(getBotResponse("pretest 21").answer, "0.5 A");
  assert.equal(getBotResponse("pretest 99").matched, false);
  assert.doesNotMatch(getBotResponse("A 24 V source is connected in series with 2 Ω and 4 Ω resistors. What is the circuit current?").answer, /^2 A/);
});

test("shared questions describe both laws without choosing an arbitrary experiment", () => {
  const comparison = getBotResponse("What is the difference between KCL and KVL?");
  assert.match(comparison.answer, /conservation of charge/);
  assert.match(comparison.answer, /conservation of energy/);
  assert.doesNotMatch(comparison.answer, /mesh/);
  const table = getBotResponse("What is the observation table used for?");
  assert.match(table.answer, /I1, I2, and I3/);
  assert.match(table.answer, /V1, V2, and V3/);
  const procedures = getBotResponse("KCL and KVL procedures", { experiment: "KCL" });
  assert.match(procedures.answer, /KCL Procedure/);
  assert.match(procedures.answer, /KVL Procedure/);
});
