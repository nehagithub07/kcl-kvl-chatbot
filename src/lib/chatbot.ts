import Fuse from "fuse.js";
import { qaData } from "../data/qaData";
import type { ChatContext, ChatResponse, Experiment, QAItem } from "../types/chatbot";

export function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase()
    .replace(/[’‘']/g, "")
    .replace(/kirchhoffs?\s+current\s+law/g, "kcl")
    .replace(/kirchhoffs?\s+voltage\s+law/g, "kvl")
    .replace(/\bk\s+c\s+l\b/g, "kcl")
    .replace(/\bk\s+v\s+l\b/g, "kvl")
    .replace(/ω/g, "ohm")
    .replace(/\bauto[ -]?connect\b/g, "auto connect")
    .replace(/\b(cant|cannot|couldnt)\b/g, "cannot")
    .replace(/\bnot (showing|displaying|reading) (any )?current\b/g, "shows zero")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

const stopWords = new Set((
  "a an the is are was were be been being do does did how what which where when " +
  "i me my you your we our it its this that these those they their them to of for " +
  "in on at by with and or as can could would should please tell explain define " +
  "about help want know use used using simulation experiment section button"
).split(" "));

const synonyms: Record<string, string> = {
  ammeters: "ammeter", voltmeters: "voltmeter", meters: "meter",
  resistors: "resistor", resistances: "resistance", currents: "current",
  voltages: "voltage", readings: "reading", observations: "observation",
  connections: "connection", connected: "connect", connecting: "connect",
  wires: "wire", sliders: "slider", equations: "equation", steps: "step",
  rated: "rating", range: "rating", purpose: "function", maximum: "max",
  minimum: "min", delete: "remove", incorrect: "wrong", incorrectly: "wrong",
  graphing: "plot", plotting: "plot", restart: "reset", versus: "vs",
  disabled: "cannot", adjust: "set", shows: "show", showing: "show",
};

function tokens(text: string): string[] {
  return [...new Set(normalizeText(text).split(" ")
    .filter((word) => word && !stopWords.has(word))
    .map((word) => synonyms[word] ?? word))];
}

function detectExperiment(text: string): Experiment | undefined {
  const input = normalizeText(text);
  const kcl = /\bkcl\b/.test(input);
  const kvl = /\bkvl\b/.test(input);
  return kcl === kvl ? undefined : kcl ? "KCL" : "KVL";
}

const searchableData = qaData.map((item) => {
  const phrases = [item.question, ...item.variations];
  return {
    ...item,
    experiment: detectExperiment(item.category) ?? detectExperiment(item.question),
    normalizedPhrases: phrases.map(normalizeText),
    normalizedKeywords: item.keywords.map(normalizeText),
    tokenGroups: [...phrases.map(tokens), tokens(item.keywords.join(" "))],
  };
});

const fuse = new Fuse(searchableData, {
  includeScore: true,
  threshold: 0.35,
  ignoreLocation: true,
  keys: [
    { name: "normalizedPhrases", weight: 0.8 },
    { name: "normalizedKeywords", weight: 0.2 },
  ],
});

const frequency = new Map<string, number>();
for (const item of searchableData) {
  for (const token of new Set(item.tokenGroups.flat())) {
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
}

function weight(token: string): number {
  // Rare terms carry more information than words shared by most questions.
  return 1 + Math.log((qaData.length + 1) / ((frequency.get(token) ?? 0) + 1));
}

function correctTypo(token: string): string {
  if (frequency.has(token) || token.length < 4 || /\d/.test(token)) return token;
  // Correct a single insertion, deletion, substitution, or transposition only
  // when the knowledge-base vocabulary provides one unambiguous candidate.
  const candidates = [...frequency.keys()].filter((word) => {
    if (word[0] !== token[0] || Math.abs(word.length - token.length) > 1) return false;
    if (word.length === token.length) {
      const differences = [...word].map((char, index) => char === token[index] ? -1 : index).filter((index) => index >= 0);
      return differences.length === 1 || (differences.length === 2 &&
        differences[1] === differences[0] + 1 &&
        word[differences[0]] === token[differences[1]] && word[differences[1]] === token[differences[0]]);
    }
    const longer = word.length > token.length ? word : token;
    const shorter = word.length > token.length ? token : word;
    return [...longer].some((_, index) => longer.slice(0, index) + longer.slice(index + 1) === shorter);
  });
  return candidates.length === 1 ? candidates[0] : token;
}

function responseFor(item: QAItem, context: ChatContext): ChatResponse {
  const experiment = detectExperiment(item.category) ?? context.experiment;
  const nextContext = experiment !== context.experiment ? { experiment } : context;
  return {
    matched: true,
    answer: item.answer,
    matchedQuestion: item.question,
    context: { ...nextContext, lastMatchedId: item.id },
  };
}

function guideResponse(order: number, context: ChatContext): ChatResponse {
  const experiment = context.experiment ?? "KCL";
  const guideSteps = qaData.filter((item) => item.guideStep && item.category === `${experiment} Procedure`)
    .sort((a, b) => a.guideStep!.order - b.guideStep!.order);
  const item = guideSteps.find((step) => step.guideStep!.order === order);
  if (!item) {
    return {
      matched: true,
      answer: `You have reached the end of the ${experiment} procedure. You can type “previous step” to revisit a step or “start ${experiment} walkthrough” to begin again.`,
      context,
    };
  }
  return {
    matched: true,
    answer: `${experiment} — Step ${order} of ${guideSteps.length}\n\n${item.guideStep!.instruction}` +
      (order === 1 ? "\n\nFollow the step in the simulator, then type “next”. I can guide you, but cannot see or change your circuit." : ""),
    matchedQuestion: item.question,
    context: { ...context, experiment, walkthroughStep: order, lastMatchedId: item.id },
  };
}

function followUpQuery(input: string, context: ChatContext): string {
  const previous = searchableData.find((item) => item.id === context.lastMatchedId);
  if (!previous) return input;
  // An explicit change of law takes precedence over the previous turn.
  if (/^(and |what about |how about )?(kcl|kvl)$/.test(input) &&
      previous.experiment && detectExperiment(input) !== previous.experiment) {
    return normalizeText(previous.question).replace(/\bkcl\b|\bkvl\b/g, detectExperiment(input)!.toLowerCase());
  }
  const isFollowUp = /\b(it|its|their|that|them)\b/.test(input) ||
    /^(and |what about |how about )/.test(input);
  if (!isFollowUp && !["rating", "range"].includes(input)) return input;
  const subjects = ["power supply", "ammeter", "voltmeter", "resistance", "observation table", "graph", "report"];
  const previousQuestion = normalizeText(previous.question);
  const subject = subjects.find((candidate) => previousQuestion.includes(candidate));
  // Avoid importing the old subject when the user names a different one.
  if (!subject || subjects.some((candidate) => input.includes(candidate))) return input;
  return `${input} ${subject}`;
}

function clarify(context: ChatContext, answer?: string): ChatResponse {
  return {
    matched: false,
    answer: answer ?? "Please include the instrument, control, or law you mean so I can give you an accurate answer.",
    context,
  };
}

export function getBotResponse(userInput: string, previousContext: ChatContext = {}): ChatResponse {
  // Accept a pasted MCQ, but search only its question, never its distractors.
  const questionText = userInput.replace(/(?:^|\n)\s*[A-D][.)]\s+[\s\S]*/, "")
    .replace(/^\s*\d+[.)]\s*\[(?:KCL|KVL)\]\s*/i, "");
  const input = normalizeText(questionText);
  const instrumentExperiment = /\bammeter(s)?\b/.test(input) !== /\bvoltmeter(s)?\b/.test(input)
    ? /\bammeter(s)?\b/.test(input) ? "KCL" : "KVL"
    : undefined;
  const explicitExperiment = detectExperiment(input) ?? instrumentExperiment;
  const context: ChatContext = explicitExperiment && explicitExperiment !== previousContext.experiment
    ? { experiment: explicitExperiment, lastMatchedId: previousContext.lastMatchedId }
    : { ...previousContext };
  if (!input) return clarify(context, "Ask a question about KCL, KVL, or the simulation controls.");

  const quizReference = input.match(/\b(pre|post)\s*test\s*(?:question\s*|q\s*)?(\d+)\b/);
  if (quizReference) {
    const item = qaData.find((entry) => entry.quiz?.stage === quizReference[1] && entry.quiz.number === Number(quizReference[2]));
    return item ? responseFor(item, context) : clarify(context, "The supplied pre-test and post-test each contain questions 1–30. Please include a valid question number.");
  }
  const directQuiz = searchableData.find((item) => item.quiz && item.normalizedPhrases.includes(input));
  if (directQuiz) {
    if (directQuiz.quiz?.requiresDiagram) return clarify(context, "This question depends on its circuit diagram. Please include the pre-test or post-test question number to retrieve the supplied answer for that exact circuit.");
    return responseFor(directQuiz, context);
  }
  const stepReference = input.match(/\bstep\s+(\d+)\b/);
  if (stepReference) {
    if (!context.experiment) return clarify(context, "Please include KCL or KVL with the step number.");
    const order = Number(stepReference[1]);
    return order >= 1 && order <= 12 ? guideResponse(order, context) : clarify(context, "Each experimental procedure has 12 steps. Please specify a step from 1 to 12.");
  }

  if (/\b(procedures?|steps|from (the )?beginning|from start to finish)\b/.test(input) &&
      !/\b(after|before|why|cannot|wrong|verify)\b/.test(input)) {
    const bothLaws = /\bkcl\b/.test(input) && /\bkvl\b/.test(input);
    const procedures = qaData.filter((item) => item.procedureOverview &&
      (bothLaws || !context.experiment || item.category === `${context.experiment} Procedure`));
    return { matched: true, answer: procedures.map((item) => `${item.category}\n\n${item.answer}`).join("\n\n"), context: procedures.length === 1 ? { ...context, lastMatchedId: procedures[0].id } : context };
  }

  if (/^(hi+|hello|hey|hello there|good morning|good afternoon|good evening)$/.test(input)) {
    return { matched: true, answer: "Hello! Ask me about KCL, KVL, the experimental procedures, circuit connections, or readings. Both laws are available in this chat.", context };
  }
  if (/^(thanks|thank you|thankyou|thanks a lot|ok|okay)$/.test(input)) {
    return { matched: true, answer: "You’re welcome! Ask another question whenever you’re ready.", context };
  }
  if (/^(bye|goodbye|see you)$/.test(input)) {
    return { matched: true, answer: "Goodbye! All the best with your experiment.", context };
  }

  if (/^(start|begin|restart) (the )?((kcl|kvl) )?(walkthrough|guide)$/.test(input) ||
      /^(guide me|walk me through)( the)?( kcl| kvl)?( experiment| simulation)?( step by step)?$/.test(input)) {
    if (!context.experiment) return clarify(context, "Please name KCL or KVL to start its step-by-step walkthrough.");
    return guideResponse(1, context);
  }
  if (/^(next|next step|continue|done|what next|what should i do next)$/.test(input)) {
    if (context.walkthroughStep) return guideResponse(context.walkthroughStep + 1, context);
    return clarify(context, "Please include the law and the step you have reached so I can tell you what comes next.");
  }
  if (/^(previous|back|previous step|go back|repeat|repeat step)$/.test(input) && context.walkthroughStep) {
    const order = /^(repeat)/.test(input) ? context.walkthroughStep : Math.max(1, context.walkthroughStep - 1);
    return guideResponse(order, context);
  }

  const query = followUpQuery(input, context);
  const queryTokens = [...new Set(tokens(query).map(correctTypo))];
  if (queryTokens.length === 0) return clarify(context);
  if (queryTokens.every((token) => ["rating", "meter", "and"].includes(token))) {
    return clarify(context, "Please name the instrument whose rating you need.");
  }

  const mentionsBothLaws = queryTokens.includes("kcl") && queryTokens.includes("kvl");
  const eligible = searchableData.filter((item) => !item.guideStep &&
    (mentionsBothLaws || !context.experiment || !item.experiment || item.experiment === context.experiment));
  const scopedQuery = context.experiment
    ? query.replace(/\bthis experiment\b/g, `the ${context.experiment.toLowerCase()} experiment`)
    : query;
  const scopedMatches = eligible.filter((item) => item.normalizedPhrases.includes(scopedQuery));
  const exactMatches = scopedMatches.length ? scopedMatches : eligible.filter((item) => item.normalizedPhrases.includes(query));
  if (exactMatches.length) {
    const quizMatch = exactMatches.find((item) => item.quiz);
    if (quizMatch?.quiz?.requiresDiagram) return clarify(context, "This question depends on its circuit diagram. Please include the pre-test or post-test question number to retrieve the supplied answer for that exact circuit.");
    if (quizMatch) return responseFor(quizMatch, context);
    const priority = (item: typeof exactMatches[number]) =>
      (item.experiment === context.experiment ? 4 : 0) +
      (normalizeText(item.question) === query ? 2 : 0) +
      (item.category.endsWith("Walkthrough") ? 1 : 0);
    exactMatches.sort((a, b) => priority(b) - priority(a));
    return responseFor(exactMatches[0], context);
  }

  const fuzzyScores = new Map(fuse.search(query).map((result) => [result.item.id, 1 - (result.score ?? 1)]));
  const totalWeight = queryTokens.reduce((sum, token) => sum + weight(token), 0);
  const numericValues: string[] = query.match(/\b\d+\b/g) ?? [];
  const ranked = eligible.filter((item) => !item.quiz).map((item) => {
    const entities = queryTokens.filter((token) => /^(kcl|kvl|ammeter|voltmeter|[riv][123])$/.test(token));
    const itemTokens = new Set(item.tokenGroups.flat());
    const missingEntity = entities.some((entity) => !itemTokens.has(entity));
    let coverage = 0;
    let lexicalScore = 0;
    for (const group of item.tokenGroups) {
      const overlap = queryTokens.filter((token) => group.includes(token));
      const recall = overlap.reduce((sum, token) => sum + weight(token), 0) / totalWeight;
      const precision = overlap.length / Math.max(group.length, 1);
      lexicalScore = Math.max(lexicalScore, 0.8 * recall + 0.2 * precision);
      coverage = Math.max(coverage, recall);
    }
    const fuzzy = fuzzyScores.get(item.id) ?? 0;
    const score = Math.max(lexicalScore, fuzzy * 0.88) +
      (context.experiment === item.experiment ? 0.02 : 0) +
      (item.category.endsWith("Walkthrough") ? 0.01 : 0);
    // Never return a worked example for a different set of supplied numbers.
    const exampleNumbers: string[] = normalizeText(item.question).match(/\b\d+\b/g) ?? [];
    const wrongExample = numericValues.length > 0 && exampleNumbers.length > 0 &&
      numericValues.some((value) => !exampleNumbers.includes(value));
    return { item, score: wrongExample || missingEntity ? 0 : score, coverage, fuzzy };
  }).sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 0.7 || (best.coverage < 0.55 && best.fuzzy < 0.87)) {
    return clarify(context, "I don’t have a confirmed answer for that question in the supplied lab material. Please add the specific control, instrument, or experiment details.");
  }
  const runnerUp = ranked.find((result) => result.item.id !== best.item.id &&
    normalizeText(result.item.question) !== normalizeText(best.item.question) &&
    normalizeText(result.item.answer) !== normalizeText(best.item.answer));
  if (queryTokens.length <= 2 && runnerUp && best.score - runnerUp.score < 0.025 && best.score < 0.95) {
    return clarify(context);
  }
  return responseFor(best.item, context);
}
