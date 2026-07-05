// scripts/canvas-harness/cards-test-entry.mjs
import assert from "node:assert/strict";

// obsidian_plugin/src/features/quest-canvas/model.ts
var GATE_GAP_X = 520;
var INTRODUCER_ORIGIN_X = -GATE_GAP_X;
var NUMERIC_OPERATOR_PATTERN = "(<=|>=|==|!=|=|<|>)";

// obsidian_plugin/src/features/quest-canvas/utils.ts
function stripWikilinkSyntax(text) {
  return text.replace(/\[\[(?:[^|\]]*?\|)?([^|\]]*?)\]\]/g, "$1").trim();
}
function stripQuotes(text) {
  return text.replace(/^"|"$/g, "");
}
function getStringValue(frontmatter, key) {
  const value = frontmatter[key];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return void 0;
}

// obsidian_plugin/src/features/quest-canvas/cards.ts
function parseConditions(frontmatter, questIds) {
  const conditions = [];
  const speakerFields = [
    ["Disposition", "Disposition"],
    ["Sex", "Sex"],
    ["Race", "Race"],
    ["Class", "Class"],
    ["Faction", "Faction"],
    ["Rank", "Rank"],
    ["PC Faction", "PC Faction"],
    ["PC Rank", "PC Rank"],
    ["Cell", "Cell"],
    ["ID", "ID"]
  ];
  for (const [field, label] of speakerFields) {
    const value = getStringValue(frontmatter, field);
    if (!value) {
      continue;
    }
    conditions.push({
      kind: "speaker",
      displayText: `${label} = ${value}`
    });
  }
  for (let index = 0; index <= 9; index += 1) {
    const rawFunction = getStringValue(frontmatter, `Function${index}`);
    const rawVariable = getStringValue(frontmatter, `Variable${index}`);
    if (!rawVariable) {
      continue;
    }
    const parsedJournal = parseJournalCondition(rawFunction ?? "", rawVariable, questIds);
    if (parsedJournal) {
      conditions.push(parsedJournal);
      continue;
    }
    const parsedChoice = parseChoiceCondition(rawFunction ?? "", rawVariable);
    if (parsedChoice) {
      conditions.push(parsedChoice);
      continue;
    }
    if ((rawFunction ?? "").trim() === "Item") {
      const itemCondition = parseNumericVariableCondition(rawVariable);
      conditions.push({
        kind: "item",
        displayText: `Item ${rawVariable}`,
        questId: itemCondition?.id,
        operator: itemCondition?.operator,
        value: itemCondition?.value
      });
      continue;
    }
    const prefix = rawFunction && rawFunction !== "Function" ? `${rawFunction} ` : "";
    const numericCondition = parseNumericVariableCondition(rawVariable);
    if (numericCondition) {
      conditions.push({
        kind: "variable",
        displayText: `${prefix}${rawVariable}`,
        questId: `${rawFunction?.trim() || "Function"}:${numericCondition.id}`,
        operator: numericCondition.operator,
        value: numericCondition.value
      });
      continue;
    }
    conditions.push({
      kind: "other",
      displayText: `${prefix}${rawVariable}`
    });
  }
  return orderConditions(conditions);
}
function parseJournalCondition(rawFunction, rawVariable, questIds) {
  const isJournalFunction = rawFunction.trim() === "Journal";
  const matchingQuestId = questIds.find((questId) => rawVariable.includes(questId));
  if (!isJournalFunction && !matchingQuestId) {
    return null;
  }
  const journalMatch = rawVariable.match(new RegExp(`([^\\s]+)\\s*${NUMERIC_OPERATOR_PATTERN}\\s*(-?\\d+)`));
  if (!journalMatch) {
    return {
      kind: "journal",
      displayText: `Journal ${rawVariable}`,
      questId: matchingQuestId
    };
  }
  const journalQuestId = journalMatch[1] ?? matchingQuestId;
  const journalOperator = normalizeNumericOperator(journalMatch[2]);
  const journalValue = journalMatch[3] ?? "0";
  return {
    kind: "journal",
    displayText: `Journal ${rawVariable}`,
    questId: journalQuestId,
    operator: journalOperator,
    value: Number.parseInt(journalValue, 10)
  };
}
function parseChoiceCondition(rawFunction, rawVariable) {
  if (rawFunction.trim() !== "Function" || !/^Choice\s*=\s*-?\d+/i.test(rawVariable)) {
    return null;
  }
  const choiceMatch = rawVariable.match(/Choice\s*=\s*(-?\d+)/i);
  if (!choiceMatch) {
    return null;
  }
  const choiceValue = choiceMatch[1] ?? "0";
  return {
    kind: "choice",
    displayText: rawVariable,
    choiceValue: Number.parseInt(choiceValue, 10)
  };
}
function parseNumericVariableCondition(rawVariable) {
  const variableMatch = rawVariable.match(new RegExp(`([^\\s]+)\\s*${NUMERIC_OPERATOR_PATTERN}\\s*(-?\\d+)`));
  if (!variableMatch) {
    return null;
  }
  const id = variableMatch[1];
  const operator = normalizeNumericOperator(variableMatch[2]);
  const value = variableMatch[3];
  if (id === void 0 || operator === void 0 || value === void 0) {
    return null;
  }
  return {
    id,
    operator,
    value: Number.parseInt(value, 10)
  };
}
function normalizeNumericOperator(operator) {
  if (operator === "<=" || operator === ">=" || operator === "<" || operator === ">" || operator === "==" || operator === "!=") {
    return operator;
  }
  return "=";
}
function parseResultActions(resultText, questIds) {
  if (resultText.trim().length === 0) {
    return [];
  }
  const actions = [];
  const lines = resultText.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  for (const line of lines) {
    const journalMatch = line.match(/^Journal\s+"?([^"\s]+)"?\s+(-?\d+)/i);
    if (journalMatch) {
      const journalQuestId = journalMatch[1] ?? "";
      const journalIndex = journalMatch[2] ?? "0";
      actions.push({
        kind: "journal-set",
        displayText: `Journal [[${journalQuestId} ${journalIndex}]]`,
        targetQuestId: journalQuestId,
        targetJournalIndex: Number.parseInt(journalIndex, 10)
      });
      continue;
    }
    if (/^Choice\s+/i.test(line)) {
      for (const choice of parseChoiceResults(line)) {
        actions.push(choice);
      }
      continue;
    }
    const addTopicTarget = parseAddTopicTarget(line);
    if (addTopicTarget) {
      actions.push({
        kind: "add-topic",
        displayText: `AddTopic "[[${addTopicTarget}]]"`,
        targetTopic: addTopicTarget
      });
      continue;
    }
    if (/^Goodbye$/i.test(line)) {
      actions.push({ kind: "goodbye", displayText: "Goodbye" });
      continue;
    }
    if (/^ModDisposition\s+-?\d+/i.test(line)) {
      actions.push({ kind: "disposition", displayText: line });
      continue;
    }
    actions.push({ kind: "script", displayText: line });
  }
  return actions;
}
function parseAddTopicTarget(line) {
  const match = line.match(/^AddTopic\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const target = stripQuotes(match[1] ?? "").trim();
  return target.length > 0 ? stripWikilinkSyntax(target) : null;
}
function parseChoiceResults(line) {
  const actions = [];
  const choicePattern = /"([^"]+)"\s+(-?\d+)/g;
  let match = choicePattern.exec(line);
  while (match) {
    const choiceLabel = match[1] ?? "";
    const choiceValue = match[2] ?? "0";
    actions.push({
      kind: "choice-set",
      displayText: `"${choiceLabel}" - Choice ${choiceValue}`,
      choiceValue: Number.parseInt(choiceValue, 10),
      choiceText: choiceLabel
    });
    match = choicePattern.exec(line);
  }
  return actions;
}
function renderConditionBlock(conditions) {
  return conditions.map((condition) => condition.displayText).join("\n");
}
function orderConditions(conditions) {
  const order = [
    "Disposition",
    "Sex",
    "Race",
    "Class",
    "Faction",
    "Rank",
    "PC Faction",
    "PC Rank",
    "Cell",
    "ID"
  ];
  return [...conditions].sort((left, right) => {
    const leftLabel = left.displayText.split(" = ")[0] ?? left.displayText;
    const rightLabel = right.displayText.split(" = ")[0] ?? right.displayText;
    const leftIndex = order.indexOf(leftLabel);
    const rightIndex = order.indexOf(rightLabel);
    if (leftIndex !== rightIndex) {
      return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
    }
    return left.displayText.localeCompare(right.displayText);
  });
}
var SPEAKER_FIELDS = [
  "Disposition",
  "Sex",
  "Race",
  "Class",
  "Faction",
  "Rank",
  "PC Faction",
  "PC Rank",
  "Cell",
  "ID"
];
var FILTER_KINDS = [
  "Function",
  "Global",
  "Local",
  "Journal",
  "Item",
  "Dead",
  "NotId",
  "NotFaction",
  "NotClass",
  "NotRace",
  "NotCell",
  "NotLocal"
];
var SPEAKER_LINE_PATTERN = new RegExp(
  `^(${SPEAKER_FIELDS.map((field) => field.replace(" ", "\\s+")).join("|")})\\s*=\\s*(.+)$`
);
var CHOICE_LINE_PATTERN = /^Choice\s*=\s*(-?\d+)$/i;
var FILTER_LINE_PATTERN = new RegExp(
  `^(${FILTER_KINDS.filter((kind) => kind !== "Function").join("|")})\\s+(\\S.*)$`
);
function parseGateLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { error: "Empty condition line." };
  }
  const speakerMatch = trimmed.match(SPEAKER_LINE_PATTERN);
  if (speakerMatch) {
    const field = SPEAKER_FIELDS.find(
      (candidate) => candidate.replace(/\s+/g, " ") === (speakerMatch[1] ?? "").replace(/\s+/g, " ")
    );
    const value = (speakerMatch[2] ?? "").trim();
    if (field && value.length > 0) {
      return { kind: "speaker", field, value };
    }
  }
  const choiceMatch = trimmed.match(CHOICE_LINE_PATTERN);
  if (choiceMatch) {
    return { kind: "choice", choiceValue: Number.parseInt(choiceMatch[1] ?? "0", 10) };
  }
  const filterMatch = trimmed.match(FILTER_LINE_PATTERN);
  if (filterMatch) {
    const filterKind = FILTER_KINDS.find((candidate) => candidate === filterMatch[1]);
    const variable = (filterMatch[2] ?? "").trim();
    if (filterKind && variable.length > 0) {
      return { kind: "filter", filterKind, variable };
    }
  }
  if (FILTER_KINDS.some((kind) => kind.toLowerCase() === trimmed.toLowerCase())) {
    return { error: `Filter "${trimmed}" is missing its condition (expected "${trimmed} <id> <op> <value>").` };
  }
  return { kind: "filter", filterKind: "Function", variable: trimmed };
}
function parseGateCardText(text) {
  const lines = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine.trim().length === 0) {
      continue;
    }
    const parsed = parseGateLine(rawLine);
    if ("error" in parsed) {
      return { ok: false, error: parsed.error };
    }
    lines.push(parsed);
  }
  return { ok: true, lines };
}
function renderGateLine(line) {
  switch (line.kind) {
    case "speaker":
      return `${line.field} = ${line.value}`;
    case "choice":
      return `Choice = ${line.choiceValue}`;
    case "filter":
      return line.filterKind === "Function" ? normalizeVariableExpression(line.variable) : `${line.filterKind} ${normalizeVariableExpression(line.variable)}`;
  }
}
function normalizeVariableExpression(variable) {
  const match = variable.trim().match(
    new RegExp(`^(.*?)\\s*${NUMERIC_OPERATOR_PATTERN}\\s*(-?\\d+(?:\\.\\d+)?)$`)
  );
  if (!match) {
    return variable.trim();
  }
  const id = (match[1] ?? "").trim();
  if (id.length === 0) {
    return variable.trim();
  }
  return `${id} ${match[2]} ${match[3]}`;
}
function gateLineToFrontmatter(line) {
  switch (line.kind) {
    case "speaker":
      return { speakerField: line.field, value: line.value };
    case "choice":
      return { functionValue: "Function", variableValue: `Choice = ${line.choiceValue}` };
    case "filter":
      return { functionValue: line.filterKind, variableValue: normalizeVariableExpression(line.variable) };
  }
}
function filterSlotToGateLine(functionValue, variableValue) {
  const trimmedFunction = functionValue.trim();
  const trimmedVariable = variableValue.trim();
  if (trimmedFunction === "Function") {
    const choiceMatch = trimmedVariable.match(CHOICE_LINE_PATTERN);
    if (choiceMatch) {
      return { kind: "choice", choiceValue: Number.parseInt(choiceMatch[1] ?? "0", 10) };
    }
    return { kind: "filter", filterKind: "Function", variable: trimmedVariable };
  }
  const filterKind = FILTER_KINDS.find((candidate) => candidate === trimmedFunction);
  if (filterKind) {
    return { kind: "filter", filterKind, variable: trimmedVariable };
  }
  return { kind: "filter", filterKind: "Function", variable: `${trimmedFunction} ${trimmedVariable}`.trim() };
}
var JOURNAL_WIKILINK_LINE_PATTERN = /^Journal\s+\[\[(?:[^\]|]*\|)?([^\]|]+?)\s+(-?\d+)\]\]$/i;
var JOURNAL_RAW_LINE_PATTERN = /^Journal\s+"?([^"\s]+)"?\s+(-?\d+)$/i;
var CHOICE_RESULT_LINE_PATTERN = /^Choice\s+"([^"]+)"\s+(-?\d+)$/i;
function parseResultCardLine(line) {
  const trimmed = line.trim();
  const wikilinkMatch = trimmed.match(JOURNAL_WIKILINK_LINE_PATTERN);
  if (wikilinkMatch) {
    return {
      kind: "journal",
      questId: wikilinkMatch[1] ?? "",
      index: Number.parseInt(wikilinkMatch[2] ?? "0", 10)
    };
  }
  const rawJournalMatch = trimmed.match(JOURNAL_RAW_LINE_PATTERN);
  if (rawJournalMatch) {
    return {
      kind: "journal",
      questId: rawJournalMatch[1] ?? "",
      index: Number.parseInt(rawJournalMatch[2] ?? "0", 10)
    };
  }
  const choiceMatch = trimmed.match(CHOICE_RESULT_LINE_PATTERN);
  if (choiceMatch) {
    return {
      kind: "choice",
      text: choiceMatch[1] ?? "",
      choiceValue: Number.parseInt(choiceMatch[2] ?? "0", 10)
    };
  }
  const addTopicTarget = parseAddTopicTarget(trimmed);
  if (addTopicTarget) {
    return { kind: "add-topic", topic: addTopicTarget };
  }
  return { kind: "script", text: trimmed };
}
function parseResultCardText(text) {
  return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map((line) => parseResultCardLine(line));
}
function renderResultNoteLine(line) {
  switch (line.kind) {
    case "journal":
      return `Journal "${line.questId}" ${line.index}`;
    case "add-topic":
      return `AddTopic "${line.topic}"`;
    case "choice":
      return `Choice "${line.text}" ${line.choiceValue}`;
    case "script":
      return line.text;
  }
}

// scripts/canvas-harness/cards-test-entry.mjs
var OPERATORS = ["=", "==", "!=", "<", "<=", ">", ">="];
var testCount = 0;
function check(name, fn) {
  testCount += 1;
  try {
    fn();
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}
for (const field of SPEAKER_FIELDS) {
  check(`speaker round-trip: ${field}`, () => {
    const line = { kind: "speaker", field, value: field === "Disposition" ? "30" : "Wise Woman" };
    const rendered = renderGateLine(line);
    assert.deepEqual(parseGateLine(rendered), line);
    assert.equal(renderGateLine(parseGateLine(rendered)), rendered);
  });
}
for (const filterKind of FILTER_KINDS) {
  for (const operator of OPERATORS) {
    check(`filter round-trip: ${filterKind} ${operator}`, () => {
      const line = { kind: "filter", filterKind, variable: `some_id ${operator} 10` };
      const rendered = renderGateLine(line);
      const parsed = parseGateLine(rendered);
      assert.deepEqual(parsed, line);
      assert.equal(renderGateLine(parsed), rendered);
    });
  }
}
check("choice round-trip", () => {
  for (const value of [0, 1, 2, 9, -1]) {
    const line = { kind: "choice", choiceValue: value };
    assert.deepEqual(parseGateLine(renderGateLine(line)), line);
  }
});
check("normalization: loose spacing becomes canonical", () => {
  assert.equal(renderGateLine(parseGateLine("Choice=2")), "Choice = 2");
  assert.equal(renderGateLine(parseGateLine("Journal my_quest>=10")), "Journal my_quest >= 10");
  assert.equal(renderGateLine(parseGateLine("Global ABtv_GalosRetired=2")), "Global ABtv_GalosRetired = 2");
  assert.equal(normalizeVariableExpression("a  <=  5"), "a <= 5");
});
check("filter id with spaces round-trips", () => {
  const parsed = parseGateLine("Dead kashtes ilabael > 0");
  assert.deepEqual(parsed, { kind: "filter", filterKind: "Dead", variable: "kashtes ilabael > 0" });
  assert.equal(renderGateLine(parsed), "Dead kashtes ilabael > 0");
});
check("bare expression is a Function-kind filter", () => {
  const parsed = parseGateLine("PCLevel > 5");
  assert.deepEqual(parsed, { kind: "filter", filterKind: "Function", variable: "PCLevel > 5" });
  assert.equal(renderGateLine(parsed), "PCLevel > 5");
});
check("bare filter kind is an error", () => {
  assert.ok("error" in parseGateLine("Journal"));
  assert.ok("error" in parseGateLine("Dead"));
});
check("gate card text: blank lines skipped, errors propagate", () => {
  const ok = parseGateCardText("Class = Wise Woman\n\nJournal quest = 10\n");
  assert.equal(ok.ok, true);
  assert.equal(ok.lines.length, 2);
  const bad = parseGateCardText("Class = Wise Woman\nJournal\n");
  assert.equal(bad.ok, false);
});
check("gateLineToFrontmatter/filterSlotToGateLine are inverse for filters", () => {
  for (const filterKind of FILTER_KINDS) {
    const line = { kind: "filter", filterKind, variable: "quest_id = 10" };
    const slot = gateLineToFrontmatter(line);
    assert.equal(slot.functionValue, filterKind);
    assert.deepEqual(filterSlotToGateLine(slot.functionValue, slot.variableValue), line);
  }
});
check("choice line maps to Function/Choice slot and back", () => {
  const slot = gateLineToFrontmatter({ kind: "choice", choiceValue: 3 });
  assert.deepEqual(slot, { functionValue: "Function", variableValue: "Choice = 3" });
  assert.deepEqual(filterSlotToGateLine("Function", "Choice = 3"), { kind: "choice", choiceValue: 3 });
});
check("speaker line maps to a speaker key", () => {
  const slot = gateLineToFrontmatter({ kind: "speaker", field: "PC Faction", value: "Mages Guild" });
  assert.deepEqual(slot, { speakerField: "PC Faction", value: "Mages Guild" });
});
check("parseConditions display text parses back", () => {
  const frontmatter = {
    Disposition: "30",
    ID: "athanden girith",
    Function0: "Journal",
    Variable0: "MV_Quest >= 10",
    Function1: "Item",
    Variable1: "ABgh_guarHides >= 1",
    Function2: "Dead",
    Variable2: "kashtes ilabael > 0",
    Function3: "Function",
    Variable3: "Choice = 2",
    Function4: "Global",
    Variable4: "Random100 >= 0"
  };
  const conditions = parseConditions(frontmatter, ["MV_Quest"]);
  const text = renderConditionBlock(conditions);
  assert.ok(!text.includes(" - "), `no legacy separators in:
${text}`);
  const parsed = parseGateCardText(text);
  assert.equal(parsed.ok, true, `gate text must parse:
${text}`);
  assert.equal(parsed.lines.length, conditions.length);
  for (const line of parsed.lines) {
    const slotOrKey = gateLineToFrontmatter(line);
    if ("functionValue" in slotOrKey) {
      assert.deepEqual(filterSlotToGateLine(slotOrKey.functionValue, slotOrKey.variableValue), line);
    }
  }
});
check("journal result: wikilink and raw forms parse identically", () => {
  const expected = { kind: "journal", questId: "MV_Quest", index: 20 };
  assert.deepEqual(parseResultCardLine("Journal [[MV_Quest 20]]"), expected);
  assert.deepEqual(parseResultCardLine("Journal [[Some Note#^block|MV_Quest 20]]"), expected);
  assert.deepEqual(parseResultCardLine("Journal MV_Quest 20"), expected);
  assert.deepEqual(parseResultCardLine('Journal "MV_Quest" 20'), expected);
  assert.equal(renderResultNoteLine(expected), 'Journal "MV_Quest" 20');
});
check("add-topic result forms", () => {
  const expected = { kind: "add-topic", topic: "latest rumors" };
  assert.deepEqual(parseResultCardLine('AddTopic "[[latest rumors]]"'), expected);
  assert.deepEqual(parseResultCardLine("AddTopic [[latest rumors]]"), expected);
  assert.deepEqual(parseResultCardLine('AddTopic "latest rumors"'), expected);
  assert.deepEqual(parseResultCardLine("AddTopic latest rumors"), expected);
  assert.equal(renderResultNoteLine(expected), 'AddTopic "latest rumors"');
});
check("choice result line", () => {
  const expected = { kind: "choice", text: "Hand over the hides.", choiceValue: 1 };
  assert.deepEqual(parseResultCardLine('Choice "Hand over the hides." 1'), expected);
  assert.equal(renderResultNoteLine(expected), 'Choice "Hand over the hides." 1');
});
check("unknown script lines are preserved verbatim", () => {
  for (const script of [
    'Player->RemoveItem "ABgh_guarHides" 1',
    'StartScript "MyScript"',
    "ModDisposition -30",
    "Goodbye",
    'PositionCell 0 0 0 0 "Balmora"'
  ]) {
    const parsed = parseResultCardLine(script);
    assert.equal(renderResultNoteLine(parsed), script);
  }
});
check("result card text: multi-line", () => {
  const lines = parseResultCardText('Journal "MV_Quest" 100\nPlayer->RemoveItem "x" 1\n\nGoodbye\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0].kind, "journal");
  assert.equal(lines[1].kind, "script");
});
check("parseResultActions display text parses back to the same semantics", () => {
  const actions = parseResultActions(
    'Journal "MV_Quest" 100\nAddTopic "latest rumors"\nChoice "Yes." 1 "No." 2\nGoodbye\nModDisposition -10\nStartScript "s"',
    ["MV_Quest"]
  );
  for (const action of actions) {
    if (action.kind === "choice-set") {
      continue;
    }
    const parsed = parseResultCardLine(action.displayText);
    if (action.kind === "journal-set") {
      assert.equal(parsed.kind, "journal");
      assert.equal(parsed.questId, action.targetQuestId);
      assert.equal(parsed.index, action.targetJournalIndex);
    } else if (action.kind === "add-topic") {
      assert.equal(parsed.kind, "add-topic");
      assert.equal(parsed.topic, action.targetTopic);
    } else {
      assert.equal(renderResultNoteLine(parsed), action.displayText);
    }
  }
});
console.log(`cards-test: ${testCount} checks passed`);
