// scripts/canvas-harness/sync-test-entry.mjs
import assert from "node:assert/strict";

// obsidian_plugin/src/features/quest-canvas/card-meta.ts
function getCardMeta(node) {
  const meta2 = node.espCard;
  if (!meta2 || typeof meta2.role !== "string" || typeof meta2.rev !== "number") {
    return null;
  }
  return meta2;
}

// obsidian_plugin/src/features/quest-canvas/model.ts
var TEXT_NODE_HORIZONTAL_PADDING = 48;
var APPROX_TEXT_CHAR_WIDTH = 8;
var GATE_GAP_X = 520;
var INTRODUCER_ORIGIN_X = -GATE_GAP_X;
var NUMERIC_OPERATOR_PATTERN = "(<=|>=|==|!=|=|<|>)";

// obsidian_plugin/src/features/quest-canvas/utils.ts
function toWikilinkTarget(filePath, subpath) {
  const fileName = filePath.split("/").pop() ?? filePath;
  const linkPath = fileName.replace(/\.md$/i, "");
  return `${linkPath}${subpath ?? ""}`;
}
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
function measureTextHeight(text, width) {
  const lineCount = width ? estimateWrappedLineCount(text, width) : Math.max(1, text.split("\n").length);
  return Math.max(50, 26 + lineCount * 24);
}
function estimateWrappedLineCount(text, width) {
  const availableWidth = Math.max(80, width - TEXT_NODE_HORIZONTAL_PADDING);
  const maxCharsPerLine = Math.max(10, Math.floor(availableWidth / APPROX_TEXT_CHAR_WIDTH));
  let lineCount = 0;
  for (const rawLine of text.split("\n")) {
    const normalizedLine = rawLine.trim().replace(/\s+/g, " ");
    if (normalizedLine.length === 0) {
      lineCount += 1;
      continue;
    }
    lineCount += Math.max(1, Math.ceil(normalizedLine.length / maxCharsPerLine));
  }
  return Math.max(1, lineCount);
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
function renderResultAction(action, allMilestones) {
  if (action.kind !== "journal-set" || action.targetJournalIndex === void 0) {
    return action.displayText;
  }
  const targetMilestone = resolveJournalResultMilestone(action, allMilestones);
  if (!targetMilestone) {
    return action.displayText;
  }
  const labelQuestId = action.targetQuestId ?? targetMilestone.questId;
  const label = `${labelQuestId} ${action.targetJournalIndex}`;
  return `Journal [[${toWikilinkTarget(targetMilestone.file.path)}|${label}]]`;
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
function resolveJournalResultMilestone(action, allMilestones) {
  if (action.kind !== "journal-set" || action.targetJournalIndex === void 0) {
    return null;
  }
  if (action.targetQuestId) {
    return allMilestones.find(
      (milestone) => milestone.questId === action.targetQuestId && milestone.index === action.targetJournalIndex
    ) ?? null;
  }
  const matches = allMilestones.filter((milestone) => milestone.index === action.targetJournalIndex);
  if (matches.length === 1) {
    return matches[0] ?? null;
  }
  return null;
}

// obsidian_plugin/src/features/quest-canvas/frontmatter-surgeon.ts
function parseStructuredFrontmatter(frontmatter) {
  if (frontmatter.length === 0) {
    return {};
  }
  const rawLines = frontmatter.replace(/^---\n/, "").replace(/\n---\n?$/, "").split("\n");
  const parsed = {};
  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index] ?? "";
    if (!/^\S.*?:/.test(line)) {
      continue;
    }
    const separator = line.indexOf(":");
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (rawValue === "|" || rawValue === "|-") {
      const multiline = [];
      let nextIndex = index + 1;
      while (nextIndex < rawLines.length && /^\s+/.test(rawLines[nextIndex] ?? "")) {
        multiline.push((rawLines[nextIndex] ?? "").replace(/^\s{2}/, ""));
        nextIndex += 1;
      }
      parsed[key] = multiline.join("\n").trimEnd();
      index = nextIndex - 1;
      continue;
    }
    if (rawValue.length === 0) {
      const arrayValues = [];
      let nextIndex = index + 1;
      while (nextIndex < rawLines.length && /^\s*-\s+/.test(rawLines[nextIndex] ?? "")) {
        arrayValues.push(stripQuotes((rawLines[nextIndex] ?? "").replace(/^\s*-\s+/, "").trim()));
        nextIndex += 1;
      }
      parsed[key] = arrayValues.length > 0 ? arrayValues : "";
      index = nextIndex - 1;
      continue;
    }
    parsed[key] = stripQuotes(rawValue);
  }
  return parsed;
}
var FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---(?=\n|$)/;
function splitSections(content) {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { lines: [], body: content, hadFrontmatter: false };
  }
  return {
    lines: (match[1] ?? "").split("\n"),
    body: content.slice(match[0].length),
    hadFrontmatter: true
  };
}
function joinSections(sections) {
  return `---
${sections.lines.join("\n")}
---${sections.body}`;
}
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function keyLineIndex(lines, key) {
  const pattern = new RegExp(`^${escapeRegExp(key)}:`);
  return lines.findIndex((line) => pattern.test(line));
}
function continuationEnd(lines, keyIndex) {
  let end = keyIndex + 1;
  while (end < lines.length && /^\s/.test(lines[end] ?? "") && (lines[end] ?? "").trim().length > 0) {
    end += 1;
  }
  return end;
}
function setFrontmatterKey(content, key, value) {
  const sections = splitSections(content);
  const rendered = value.length > 0 ? `${key}: ${value}` : `${key}:`;
  if (!sections.hadFrontmatter) {
    return `---
${rendered}
---
${content}`;
  }
  const index = keyLineIndex(sections.lines, key);
  if (index === -1) {
    sections.lines.push(rendered);
  } else {
    sections.lines.splice(index, continuationEnd(sections.lines, index) - index, rendered);
  }
  return joinSections(sections);
}
function removeFrontmatterKey(content, key) {
  const sections = splitSections(content);
  if (!sections.hadFrontmatter) {
    return content;
  }
  const index = keyLineIndex(sections.lines, key);
  if (index === -1) {
    return content;
  }
  sections.lines.splice(index, continuationEnd(sections.lines, index) - index);
  return joinSections(sections);
}
function setResultLines(content, resultLines) {
  const sections = splitSections(content);
  if (!sections.hadFrontmatter) {
    return setFrontmatterKey(content, "Result", resultLines.join("\n"));
  }
  const index = keyLineIndex(sections.lines, "Result");
  const end = index === -1 ? -1 : continuationEnd(sections.lines, index);
  const existingKeyLine = index === -1 ? "" : sections.lines[index] ?? "";
  const wasBlock = /^Result:\s*\|/.test(existingKeyLine);
  const existingIndent = index !== -1 && end > index + 1 ? (sections.lines[index + 1] ?? "").match(/^\s*/)?.[0] ?? "  " : "  ";
  const rendered = [];
  if (resultLines.length === 0) {
    rendered.push("Result:");
  } else if (resultLines.length === 1 && !wasBlock) {
    rendered.push(`Result: ${resultLines[0]}`);
  } else {
    rendered.push("Result: |");
    for (const line of resultLines) {
      rendered.push(`${existingIndent}${line}`);
    }
  }
  if (index === -1) {
    const firstFilterIndex = sections.lines.findIndex((line) => /^Function\d:/.test(line));
    const insertAt = firstFilterIndex === -1 ? sections.lines.length : firstFilterIndex;
    sections.lines.splice(insertAt, 0, ...rendered);
  } else {
    sections.lines.splice(index, end - index, ...rendered);
  }
  return joinSections(sections);
}
function setFilterSlot(content, slot, functionValue, variableValue) {
  const sections = splitSections(content);
  if (!sections.hadFrontmatter) {
    return content;
  }
  const functionLine = `Function${slot}: ${functionValue}`;
  const variableLine = `Variable${slot}: ${variableValue}`;
  const functionIndex = keyLineIndex(sections.lines, `Function${slot}`);
  const variableIndex = keyLineIndex(sections.lines, `Variable${slot}`);
  if (functionIndex !== -1) {
    sections.lines[functionIndex] = functionLine;
  }
  if (variableIndex !== -1) {
    sections.lines[variableIndex] = variableLine;
  }
  if (functionIndex !== -1 && variableIndex !== -1) {
    return joinSections(sections);
  }
  if (functionIndex !== -1 && variableIndex === -1) {
    sections.lines.splice(functionIndex + 1, 0, variableLine);
    return joinSections(sections);
  }
  if (functionIndex === -1 && variableIndex !== -1) {
    sections.lines.splice(variableIndex, 0, functionLine);
    return joinSections(sections);
  }
  let insertAt = -1;
  for (let lineIndex = 0; lineIndex < sections.lines.length; lineIndex += 1) {
    if (/^(Function|Variable)\d:/.test(sections.lines[lineIndex] ?? "")) {
      insertAt = lineIndex + 1;
    }
  }
  if (insertAt === -1) {
    const resultIndex = keyLineIndex(sections.lines, "Result");
    insertAt = resultIndex === -1 ? sections.lines.length : continuationEnd(sections.lines, resultIndex);
  }
  sections.lines.splice(insertAt, 0, functionLine, variableLine);
  return joinSections(sections);
}
function clearFilterSlot(content, slot) {
  let next = removeFrontmatterKey(content, `Function${slot}`);
  next = removeFrontmatterKey(next, `Variable${slot}`);
  return next;
}
var MAX_FILTER_SLOT = 5;
function applyGateLines(content, gateLines) {
  let next = content;
  const current = parseStructuredFrontmatter(next.match(FRONTMATTER_PATTERN)?.[0] ?? "");
  const speakerValues = /* @__PURE__ */ new Map();
  for (const line of gateLines) {
    if (line.kind === "speaker") {
      speakerValues.set(line.field, line.value);
    }
  }
  for (const field of SPEAKER_FIELDS) {
    const desired = speakerValues.get(field);
    if (desired !== void 0) {
      next = setFrontmatterKey(next, field, desired);
      continue;
    }
    const existing = current[field];
    if (typeof existing === "string" && existing.length > 0) {
      next = setFrontmatterKey(next, field, "");
    }
  }
  const filterSlots = [];
  for (const line of gateLines) {
    if (line.kind === "speaker") {
      continue;
    }
    const slot = gateLineToFrontmatter(line);
    if ("functionValue" in slot) {
      filterSlots.push(slot);
    }
  }
  for (let slot = 0; slot < filterSlots.length; slot += 1) {
    const filterSlot = filterSlots[slot];
    if (!filterSlot) {
      continue;
    }
    next = setFilterSlot(next, slot, filterSlot.functionValue, filterSlot.variableValue);
  }
  for (let slot = filterSlots.length; slot <= Math.max(MAX_FILTER_SLOT, 9); slot += 1) {
    next = clearFilterSlot(next, slot);
  }
  return next;
}

// obsidian_plugin/src/features/quest-canvas/sync-core.ts
var CARD_WARNING_PREFIX = "\u26A0\uFE0F";
function editableCardText(text) {
  const lines = text.split("\n");
  let start = 0;
  while (start < lines.length && (lines[start] ?? "").trimStart().startsWith(CARD_WARNING_PREFIX)) {
    start += 1;
  }
  return lines.slice(start).join("\n");
}
var SYNCABLE_ROLES = /* @__PURE__ */ new Set(["gate", "result", "choice"]);
function diffCanvasTextEdits(previous, next) {
  const previousById = new Map(previous.nodes.map((node) => [node.id, node]));
  const edits = [];
  for (const node of next.nodes) {
    if (node.type !== "text") {
      continue;
    }
    const meta2 = getCardMeta(node);
    if (!meta2 || !SYNCABLE_ROLES.has(meta2.role)) {
      continue;
    }
    const previousNode = previousById.get(node.id);
    if (!previousNode) {
      continue;
    }
    const previousText = editableCardText(previousNode.text ?? "");
    const nextText = editableCardText(node.text ?? "");
    if (previousText !== nextText) {
      edits.push({ nodeId: node.id, meta: meta2, previousText, nextText });
    }
  }
  return edits;
}
function deriveQuestContext(canvas, readNote) {
  const milestones = [];
  const questIds = [];
  for (const node of canvas.nodes) {
    const meta2 = getCardMeta(node);
    if (meta2?.role !== "journal" || !meta2.file) {
      continue;
    }
    const content = readNote(meta2.file);
    if (content === null) {
      continue;
    }
    const frontmatter = parseStructuredFrontmatter(frontmatterSection(content));
    const questId = getStringValue(frontmatter, "Topic") ?? meta2.questId;
    const indexValue = getStringValue(frontmatter, "Index");
    const index = indexValue === void 0 ? Number.NaN : Number.parseInt(indexValue, 10);
    if (!questId || !Number.isFinite(index)) {
      continue;
    }
    milestones.push({ questId, index, file: { path: meta2.file } });
    if (!questIds.includes(questId)) {
      questIds.push(questId);
    }
  }
  milestones.sort((left, right) => left.index - right.index || left.file.path.localeCompare(right.file.path));
  return { milestones, questIds };
}
function planSyncFromEdits(edits, readNote, context) {
  const workingNotes = /* @__PURE__ */ new Map();
  const failures = [];
  const appliedEdits = [];
  const readWorking = (path) => workingNotes.get(path) ?? readNote(path);
  for (const edit of edits) {
    const path = edit.meta.file;
    if (!path) {
      continue;
    }
    const content = readWorking(path);
    if (content === null) {
      failures.push({ nodeId: edit.nodeId, message: `Note not found: ${path}`, userText: edit.nextText });
      continue;
    }
    switch (edit.meta.role) {
      case "gate": {
        const parsed = parseGateCardText(edit.nextText);
        if (!parsed.ok) {
          failures.push({ nodeId: edit.nodeId, message: parsed.error, userText: edit.nextText });
          continue;
        }
        workingNotes.set(path, applyGateLines(content, parsed.lines));
        appliedEdits.push(edit);
        break;
      }
      case "result": {
        const lines = parseResultCardText(edit.nextText);
        workingNotes.set(path, applyResultCardLines(content, lines));
        appliedEdits.push(edit);
        break;
      }
      case "choice": {
        if (edit.meta.choiceValue === void 0) {
          continue;
        }
        const prompt = edit.nextText.trim();
        if (prompt.length === 0) {
          failures.push({ nodeId: edit.nodeId, message: "Choice prompt cannot be empty.", userText: edit.nextText });
          continue;
        }
        if (prompt.includes('"')) {
          failures.push({
            nodeId: edit.nodeId,
            message: "Choice prompts cannot contain double quotes.",
            userText: edit.nextText
          });
          continue;
        }
        const renamed = renameChoiceInResult(content, edit.meta.choiceValue, prompt);
        if (renamed === null) {
          failures.push({
            nodeId: edit.nodeId,
            message: `No Choice ${edit.meta.choiceValue} line found in ${path}.`,
            userText: edit.nextText
          });
          continue;
        }
        workingNotes.set(path, renamed);
        appliedEdits.push(edit);
        break;
      }
      default:
        break;
    }
  }
  const noteUpdates = /* @__PURE__ */ new Map();
  for (const [path, content] of workingNotes) {
    if (content !== readNote(path)) {
      noteUpdates.set(path, content);
    }
  }
  const cardUpdates = /* @__PURE__ */ new Map();
  for (const edit of appliedEdits) {
    const path = edit.meta.file;
    if (!path) {
      continue;
    }
    const content = workingNotes.get(path) ?? readNote(path);
    if (content === null) {
      continue;
    }
    const rendered = renderCardFromNote(edit.meta, content, context);
    if (rendered !== null) {
      cardUpdates.set(edit.nodeId, rendered);
    }
  }
  return { noteUpdates, cardUpdates, failures };
}
function applySyncPlanToCanvas(canvas, plan) {
  let changed = false;
  const nodesById = new Map(canvas.nodes.map((node) => [node.id, node]));
  for (const [nodeId, text] of plan.cardUpdates) {
    const node = nodesById.get(nodeId);
    if (!node || node.text === text) {
      continue;
    }
    node.text = text;
    node.height = measureTextHeight(text, node.width);
    changed = true;
  }
  for (const failure of plan.failures) {
    const node = nodesById.get(failure.nodeId);
    if (!node) {
      continue;
    }
    const text = `${CARD_WARNING_PREFIX} ${failure.message}
${failure.userText}`;
    if (node.text === text) {
      continue;
    }
    node.text = text;
    node.height = measureTextHeight(text, node.width);
    changed = true;
  }
  return changed;
}
function renderCardFromNote(meta2, noteContent, context) {
  const frontmatter = parseStructuredFrontmatter(frontmatterSection(noteContent));
  switch (meta2.role) {
    case "gate":
      return renderConditionBlock(parseConditions(frontmatter, context.questIds));
    case "result": {
      const actions = parseResultActions(getStringValue(frontmatter, "Result") ?? "", context.questIds);
      return actions.filter((action) => action.kind !== "choice-set").map((action) => renderResultAction(action, context.milestones)).join("\n");
    }
    case "choice": {
      if (meta2.choiceValue === void 0) {
        return null;
      }
      const actions = parseResultActions(getStringValue(frontmatter, "Result") ?? "", context.questIds);
      const action = actions.find(
        (candidate) => candidate.kind === "choice-set" && candidate.choiceValue === meta2.choiceValue
      );
      return action?.choiceText ?? null;
    }
    default:
      return null;
  }
}
function applyResultCardLines(content, cardLines) {
  const frontmatter = parseStructuredFrontmatter(frontmatterSection(content));
  const originalLines = (getStringValue(frontmatter, "Result") ?? "").split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const renderedCardLines = cardLines.map((line) => renderResultNoteLine(line));
  const cardHasChoiceLines = cardLines.some((line) => line.kind === "choice");
  let nextLines;
  if (cardHasChoiceLines) {
    nextLines = renderedCardLines;
  } else {
    const isChoiceLine = (line) => /^Choice\s/i.test(line);
    nextLines = [];
    let cardIndex = 0;
    for (const original of originalLines) {
      if (isChoiceLine(original)) {
        nextLines.push(original);
        continue;
      }
      if (cardIndex < renderedCardLines.length) {
        nextLines.push(renderedCardLines[cardIndex]);
        cardIndex += 1;
      }
    }
    for (; cardIndex < renderedCardLines.length; cardIndex += 1) {
      nextLines.push(renderedCardLines[cardIndex]);
    }
  }
  return setResultLines(content, nextLines);
}
function renameChoiceInResult(content, choiceValue, prompt) {
  const frontmatter = parseStructuredFrontmatter(frontmatterSection(content));
  const resultText = getStringValue(frontmatter, "Result") ?? "";
  if (resultText.trim().length === 0) {
    return null;
  }
  const lines = resultText.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  let found = false;
  const nextLines = lines.map((line) => {
    if (!/^Choice\s/i.test(line)) {
      return line;
    }
    return line.replace(/"([^"]*)"(\s+)(-?\d+)/g, (pair, _text, spacing, value) => {
      if (Number.parseInt(value, 10) !== choiceValue) {
        return pair;
      }
      found = true;
      return `"${prompt}"${spacing}${value}`;
    });
  });
  if (!found) {
    return null;
  }
  return setResultLines(content, nextLines);
}
function frontmatterSection(content) {
  return content.match(/^---\n[\s\S]*?\n---(?:\n|$)/)?.[0] ?? "";
}
function describeEdgeGesture(edit) {
  const { gesture } = edit;
  const verb = edit.kind === "add" ? "add" : "remove";
  switch (gesture.type) {
    case "journal-advance":
      return `${gesture.sourceFile}: ${verb} result line 'Journal "${gesture.questId}" ${gesture.index}'`;
    case "offer-choice":
      return `${gesture.sourceFile}: ${verb} result line 'Choice "${gesture.prompt}" ${gesture.choiceValue}'`;
    case "choice-gate":
      return `${gesture.targetFile}: ${verb} filter 'Choice = ${gesture.choiceValue}'`;
    case "availability-gate":
      return `${gesture.targetFile}: ${verb} filter 'Journal ${gesture.questId} = ${gesture.index}'`;
  }
}
function diffCanvasEdgeGestures(previous, next, context) {
  const previousEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
  const nextEdges = new Map(next.edges.map((edge) => [edge.id, edge]));
  const edits = [];
  for (const edge of next.edges) {
    if (!previousEdges.has(edge.id)) {
      const gesture = classifyEdgeGesture(edge, next, context);
      if (gesture) {
        edits.push({ kind: "add", edgeId: edge.id, gesture });
      }
    }
  }
  for (const edge of previous.edges) {
    if (!nextEdges.has(edge.id)) {
      const gesture = classifyEdgeGesture(edge, previous, context);
      if (gesture) {
        edits.push({ kind: "remove", edgeId: edge.id, gesture });
      }
    }
  }
  return edits;
}
function classifyEdgeGesture(edge, canvas, context) {
  if (edge.espCard?.role === "derived") {
    return null;
  }
  const nodesById = new Map(canvas.nodes.map((node) => [node.id, node]));
  const fromNode = nodesById.get(edge.fromNode);
  const toNode = nodesById.get(edge.toNode);
  const fromMeta = fromNode ? getCardMeta(fromNode) : null;
  const toMeta = toNode ? getCardMeta(toNode) : null;
  if (!fromNode || !toNode || !fromMeta || !toMeta) {
    return null;
  }
  if (fromMeta.role === "dialogue" && toMeta.role === "journal" && fromMeta.file && toMeta.file) {
    const milestone = context.milestones.find((candidate) => candidate.file.path === toMeta.file);
    if (!milestone) {
      return null;
    }
    return { type: "journal-advance", sourceFile: fromMeta.file, questId: milestone.questId, index: milestone.index };
  }
  if (fromMeta.role === "dialogue" && toMeta.role === "choice" && fromMeta.file && toMeta.choiceValue !== void 0) {
    return {
      type: "offer-choice",
      sourceFile: fromMeta.file,
      choiceValue: toMeta.choiceValue,
      prompt: editableCardText(toNode.text ?? "").trim()
    };
  }
  if (fromMeta.role === "choice" && fromMeta.choiceValue !== void 0 && (toMeta.role === "gate" || toMeta.role === "dialogue") && toMeta.file) {
    return { type: "choice-gate", targetFile: toMeta.file, choiceValue: fromMeta.choiceValue };
  }
  if (fromMeta.role === "journal" && toMeta.role === "gate" && fromMeta.file && toMeta.file) {
    const milestone = context.milestones.find((candidate) => candidate.file.path === fromMeta.file);
    if (!milestone) {
      return null;
    }
    return { type: "availability-gate", targetFile: toMeta.file, questId: milestone.questId, index: milestone.index };
  }
  return null;
}
function gateLinesFromNote(content, questIds) {
  const frontmatter = parseStructuredFrontmatter(frontmatterSection(content));
  const lines = [];
  for (const condition of parseConditions(frontmatter, questIds)) {
    const parsed = parseGateLine(condition.displayText);
    if (!("error" in parsed)) {
      lines.push(parsed);
    }
  }
  return lines;
}
function upsertJournalResultLine(content, questId, index) {
  const lines = resultLinesOfContent(content);
  const pattern = journalLinePattern(questId);
  const newLine = `Journal "${questId}" ${index}`;
  const existing = lines.findIndex((line) => pattern.test(line));
  if (existing === -1) {
    lines.push(newLine);
  } else {
    lines[existing] = newLine;
  }
  return setResultLines(content, lines);
}
function removeJournalResultLine(content, questId, index) {
  const pattern = new RegExp(`^Journal\\s+"?${escapeRegExp2(questId)}"?\\s+${index}$`, "i");
  const lines = resultLinesOfContent(content).filter((line) => !pattern.test(line));
  return setResultLines(content, lines);
}
function upsertChoiceResultPair(content, prompt, choiceValue) {
  const lines = resultLinesOfContent(content);
  const hasPair = lines.some((line) => /^Choice\s/i.test(line) && choicePairValues(line).includes(choiceValue));
  if (hasPair) {
    return content;
  }
  lines.push(`Choice "${prompt}" ${choiceValue}`);
  return setResultLines(content, lines);
}
function removeChoiceResultPair(content, choiceValue) {
  const lines = [];
  for (const line of resultLinesOfContent(content)) {
    if (!/^Choice\s/i.test(line)) {
      lines.push(line);
      continue;
    }
    const stripped = line.replace(/"([^"]*)"\s+(-?\d+)\s*/g, (pair, _text, value) => Number.parseInt(value, 10) === choiceValue ? "" : pair.endsWith(" ") ? pair : `${pair} `).trim();
    if (!/^Choice$/i.test(stripped)) {
      lines.push(stripped);
    }
  }
  return setResultLines(content, lines);
}
function resultLinesOfContent(content) {
  const frontmatter = parseStructuredFrontmatter(frontmatterSection(content));
  return (getStringValue(frontmatter, "Result") ?? "").split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}
function journalLinePattern(questId) {
  return new RegExp(`^Journal\\s+"?${escapeRegExp2(questId)}"?\\s+-?\\d+$`, "i");
}
function choicePairValues(line) {
  const values = [];
  const pattern = /"[^"]*"\s+(-?\d+)/g;
  let match = pattern.exec(line);
  while (match) {
    values.push(Number.parseInt(match[1] ?? "0", 10));
    match = pattern.exec(line);
  }
  return values;
}
function escapeRegExp2(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function planEdgeGestures(edits, readNote, context, canvas) {
  const workingNotes = /* @__PURE__ */ new Map();
  const failures = [];
  const readWorking = (path) => workingNotes.get(path) ?? readNote(path);
  const touchedFiles = /* @__PURE__ */ new Set();
  for (const edit of edits) {
    const { gesture } = edit;
    const path = "sourceFile" in gesture ? gesture.sourceFile : gesture.targetFile;
    const content = readWorking(path);
    if (content === null) {
      failures.push({ nodeId: edit.edgeId, message: `Note not found: ${path}`, userText: "" });
      continue;
    }
    let next = content;
    switch (gesture.type) {
      case "journal-advance":
        next = edit.kind === "add" ? upsertJournalResultLine(content, gesture.questId, gesture.index) : removeJournalResultLine(content, gesture.questId, gesture.index);
        break;
      case "offer-choice":
        if (edit.kind === "add" && gesture.prompt.length === 0) {
          failures.push({ nodeId: edit.edgeId, message: "Choice card has no prompt text.", userText: "" });
          continue;
        }
        next = edit.kind === "add" ? upsertChoiceResultPair(content, gesture.prompt, gesture.choiceValue) : removeChoiceResultPair(content, gesture.choiceValue);
        break;
      case "choice-gate": {
        const lines = gateLinesFromNote(content, context.questIds);
        const has = lines.some((line) => line.kind === "choice" && line.choiceValue === gesture.choiceValue);
        if (edit.kind === "add" && !has) {
          lines.push({ kind: "choice", choiceValue: gesture.choiceValue });
          next = applyGateLines(content, lines);
        } else if (edit.kind === "remove" && has) {
          next = applyGateLines(
            content,
            lines.filter((line) => !(line.kind === "choice" && line.choiceValue === gesture.choiceValue))
          );
        }
        break;
      }
      case "availability-gate": {
        const lines = gateLinesFromNote(content, context.questIds);
        const matches = (line) => line.kind === "filter" && line.filterKind === "Journal" && new RegExp(`^${escapeRegExp2(gesture.questId)}\\s*(=|==)\\s*${gesture.index}$`).test(line.variable.trim());
        const has = lines.some(matches);
        if (edit.kind === "add" && !has) {
          lines.push({ kind: "filter", filterKind: "Journal", variable: `${gesture.questId} = ${gesture.index}` });
          next = applyGateLines(content, lines);
        } else if (edit.kind === "remove" && has) {
          next = applyGateLines(content, lines.filter((line) => !matches(line)));
        }
        break;
      }
    }
    if (next !== content) {
      workingNotes.set(path, next);
      touchedFiles.add(path);
    }
  }
  const noteUpdates = /* @__PURE__ */ new Map();
  for (const [path, content] of workingNotes) {
    if (content !== readNote(path)) {
      noteUpdates.set(path, content);
    }
  }
  const cardUpdates = /* @__PURE__ */ new Map();
  for (const node of canvas.nodes) {
    const meta2 = getCardMeta(node);
    if (!meta2?.file || !touchedFiles.has(meta2.file) || meta2.role !== "gate" && meta2.role !== "result") {
      continue;
    }
    const content = workingNotes.get(meta2.file) ?? readNote(meta2.file);
    if (content === null) {
      continue;
    }
    const rendered = renderCardFromNote(meta2, content, context);
    if (rendered !== null) {
      cardUpdates.set(node.id, rendered);
    }
  }
  return { noteUpdates, cardUpdates, failures };
}

// obsidian_plugin/src/features/quest-canvas/refresh.ts
function provenanceKey(node) {
  const meta2 = getCardMeta(node);
  if (!meta2) {
    return null;
  }
  return `${meta2.role}:${meta2.file ?? ""}:${meta2.choiceValue ?? ""}`;
}
function mergeCanvasPreservingLayout(existing, fresh) {
  const stats = { matched: 0, added: 0, removed: 0, userNodesKept: 0, userEdgesKept: 0 };
  const existingByProvenance = /* @__PURE__ */ new Map();
  for (const node of existing.nodes) {
    const key = provenanceKey(node);
    if (key !== null && !existingByProvenance.has(key)) {
      existingByProvenance.set(key, node);
    }
  }
  const idRemap = /* @__PURE__ */ new Map();
  const matchedExistingIds = /* @__PURE__ */ new Set();
  const mergedNodes = [];
  const unmatchedFresh = [];
  for (const freshNode of fresh.nodes) {
    const key = provenanceKey(freshNode);
    const match = key !== null ? existingByProvenance.get(key) : void 0;
    if (match) {
      stats.matched += 1;
      matchedExistingIds.add(match.id);
      idRemap.set(match.id, freshNode.id);
      mergedNodes.push({
        ...freshNode,
        x: match.x,
        y: match.y,
        width: match.width,
        height: freshNode.type === "text" ? freshNode.height : match.height
      });
    } else {
      unmatchedFresh.push(freshNode);
    }
  }
  const freshById = new Map(fresh.nodes.map((node) => [node.id, node]));
  const mergedById = new Map(mergedNodes.map((node) => [node.id, node]));
  for (const freshNode of unmatchedFresh) {
    stats.added += 1;
    const neighborEdge = fresh.edges.find(
      (edge) => edge.fromNode === freshNode.id && mergedById.has(edge.toNode) || edge.toNode === freshNode.id && mergedById.has(edge.fromNode)
    );
    let placed = { ...freshNode };
    if (neighborEdge) {
      const freshNeighborId = neighborEdge.fromNode === freshNode.id ? neighborEdge.toNode : neighborEdge.fromNode;
      const freshNeighbor = freshById.get(freshNeighborId);
      const mergedNeighbor = mergedById.get(freshNeighborId);
      if (freshNeighbor && mergedNeighbor) {
        placed = {
          ...freshNode,
          x: mergedNeighbor.x + (freshNode.x - freshNeighbor.x),
          y: mergedNeighbor.y + (freshNode.y - freshNeighbor.y)
        };
      }
    }
    mergedNodes.push(placed);
    mergedById.set(placed.id, placed);
  }
  for (const node of existing.nodes) {
    if (getCardMeta(node)) {
      if (!matchedExistingIds.has(node.id)) {
        stats.removed += 1;
      }
      continue;
    }
    stats.userNodesKept += 1;
    mergedNodes.push(node);
    mergedById.set(node.id, node);
  }
  const mergedEdges = [...fresh.edges];
  const freshEdgeIds = new Set(fresh.edges.map((edge) => edge.id));
  const generatedOldEdgeIds = /* @__PURE__ */ new Set();
  for (const edge of existing.edges) {
    if (edge.espCard?.role === "derived") {
      generatedOldEdgeIds.add(edge.id);
    }
  }
  for (const edge of existing.edges) {
    if (freshEdgeIds.has(edge.id) || generatedOldEdgeIds.has(edge.id)) {
      continue;
    }
    const fromNode = idRemap.get(edge.fromNode) ?? edge.fromNode;
    const toNode = idRemap.get(edge.toNode) ?? edge.toNode;
    if (!mergedById.has(fromNode) || !mergedById.has(toNode)) {
      continue;
    }
    if (mergedEdges.some((candidate) => candidate.fromNode === fromNode && candidate.toNode === toNode)) {
      continue;
    }
    stats.userEdgesKept += 1;
    mergedEdges.push({ ...edge, fromNode, toNode });
  }
  const merged = {
    ...existing,
    nodes: mergedNodes,
    edges: mergedEdges
  };
  return { merged, stats };
}

// scripts/canvas-harness/sync-test-entry.mjs
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
var BRANCH_PATH = "TES3 Plugins/Test/Topic/test topic/branch.md";
var INLINE_PATH = "TES3 Plugins/Test/Greeting/Greeting 1/inline.md";
var JOURNAL_10_PATH = "TES3 Plugins/Test/Journal/TestQuest/10.md";
var JOURNAL_20_PATH = "TES3 Plugins/Test/Journal/TestQuest/20.md";
var BRANCH_NOTE = [
  "---",
  "Source:",
  "Type: Topic",
  "Topic: test topic",
  "DiagID: 11111111111111111111",
  "PrevID: 22222222222222222222",
  "Disposition: 30",
  "ID: test npc",
  "Race:",
  "Sex:",
  "Class:",
  "Faction:",
  "Rank:",
  "Cell:",
  "PC Faction:",
  "PC Rank:",
  "MyCustomKey: keep me",
  "Result: |",
  '  MessageBox "custom line"',
  '  Journal "TestQuest" 20',
  '  Choice "Yes." 1 "No." 2',
  "  Goodbye",
  "Function0: Journal",
  "Variable0: TestQuest = 10",
  "Function1: Dead",
  "Variable1: kashtes ilabael > 0",
  "---",
  "",
  "",
  "Some dialogue body text."
].join("\n");
var INLINE_NOTE = [
  "---",
  "Source:",
  "Type: Greeting",
  "Topic: Greeting 1",
  "Disposition: 0",
  "Result: Goodbye",
  "Function0: Journal",
  "Variable0: TestQuest = 10",
  "---",
  "",
  "Hello there."
].join("\n");
var journalNote = (index) => [
  "---",
  "Type: Journal",
  "Topic: TestQuest",
  `Index: ${index}`,
  "---",
  "",
  `Milestone ${index}.`
].join("\n");
function makeNotes() {
  return /* @__PURE__ */ new Map([
    [BRANCH_PATH, BRANCH_NOTE],
    [INLINE_PATH, INLINE_NOTE],
    [JOURNAL_10_PATH, journalNote(10)],
    [JOURNAL_20_PATH, journalNote(20)]
  ]);
}
var meta = (role, file, extra = {}) => ({ role, file, rev: 1, ...extra });
var GATE_TEXT = "Disposition = 30\nID = test npc\nJournal TestQuest = 10\nDead kashtes ilabael > 0";
var RESULT_TEXT = 'MessageBox "custom line"\nJournal [[20|TestQuest 20]]\nGoodbye';
function makeCanvas() {
  return {
    nodes: [
      { id: "j10", type: "file", file: JOURNAL_10_PATH, x: 0, y: 0, width: 440, height: 100, color: "6", espCard: meta("journal", JOURNAL_10_PATH, { questId: "TestQuest" }) },
      { id: "j20", type: "file", file: JOURNAL_20_PATH, x: 900, y: 0, width: 440, height: 100, color: "6", espCard: meta("journal", JOURNAL_20_PATH, { questId: "TestQuest" }) },
      { id: "g1", type: "text", text: GATE_TEXT, x: 100, y: 200, width: 385, height: 100, color: "4", espCard: meta("gate", BRANCH_PATH) },
      { id: "d1", type: "file", file: BRANCH_PATH, x: 400, y: 200, width: 440, height: 120, color: "3", espCard: meta("dialogue", BRANCH_PATH) },
      { id: "r1", type: "text", text: RESULT_TEXT, x: 400, y: 340, width: 440, height: 90, color: "6", espCard: meta("result", BRANCH_PATH) },
      { id: "c1", type: "text", text: "Yes.", x: 700, y: 200, width: 320, height: 50, color: "4", espCard: meta("choice", BRANCH_PATH, { choiceValue: 1 }) },
      { id: "user-note", type: "text", text: "my own annotation", x: 0, y: 900, width: 200, height: 60 }
    ],
    edges: []
  };
}
function clone(canvas) {
  return JSON.parse(JSON.stringify(canvas));
}
function runSync(previous, next, notes) {
  const readNote = (path) => notes.get(path) ?? null;
  const edits = diffCanvasTextEdits(previous, next);
  const context = deriveQuestContext(next, readNote);
  const plan = planSyncFromEdits(edits, readNote, context);
  return { edits, plan };
}
check("position changes and user notes are layout-only", () => {
  const previous = makeCanvas();
  const next = clone(previous);
  next.nodes[2].x += 500;
  next.nodes[2].y -= 100;
  next.nodes.find((n) => n.id === "user-note").text = "edited annotation";
  next.nodes.push({ id: "pasted", type: "text", text: "pasted node", x: 1, y: 1, width: 100, height: 50 });
  assert.deepEqual(diffCanvasTextEdits(previous, next), []);
});
check("deleting an espCard node is layout-only", () => {
  const previous = makeCanvas();
  const next = clone(previous);
  next.nodes = next.nodes.filter((n) => n.id !== "g1");
  const { plan } = runSync(previous, next, makeNotes());
  assert.equal(plan.noteUpdates.size, 0);
});
check("gate edit performs frontmatter surgery and echoes canonical text", () => {
  const previous = makeCanvas();
  const next = clone(previous);
  next.nodes[2].text = "Disposition = 30\nJournal TestQuest=20\nDead kashtes ilabael > 0\nPCLevel > 5";
  const notes = makeNotes();
  const { plan } = runSync(previous, next, notes);
  assert.equal(plan.failures.length, 0);
  const expectedNote = [
    "---",
    "Source:",
    "Type: Topic",
    "Topic: test topic",
    "DiagID: 11111111111111111111",
    "PrevID: 22222222222222222222",
    "Disposition: 30",
    "ID:",
    "Race:",
    "Sex:",
    "Class:",
    "Faction:",
    "Rank:",
    "Cell:",
    "PC Faction:",
    "PC Rank:",
    "MyCustomKey: keep me",
    "Result: |",
    '  MessageBox "custom line"',
    '  Journal "TestQuest" 20',
    '  Choice "Yes." 1 "No." 2',
    "  Goodbye",
    "Function0: Journal",
    "Variable0: TestQuest = 20",
    "Function1: Dead",
    "Variable1: kashtes ilabael > 0",
    "Function2: Function",
    "Variable2: PCLevel > 5",
    "---",
    "",
    "",
    "Some dialogue body text."
  ].join("\n");
  assert.equal(plan.noteUpdates.get(BRANCH_PATH), expectedNote);
  assert.equal(
    plan.cardUpdates.get("g1"),
    "Disposition = 30\nDead kashtes ilabael > 0\nJournal TestQuest = 20\nPCLevel > 5"
  );
});
check("gate edit removing all filters clears the slots", () => {
  const previous = makeCanvas();
  const next = clone(previous);
  next.nodes[2].text = "Disposition = 30\nID = test npc";
  const { plan } = runSync(previous, next, makeNotes());
  const updated = plan.noteUpdates.get(BRANCH_PATH);
  assert.ok(!/Function\d:/.test(updated));
  assert.ok(!/Variable\d:/.test(updated));
  assert.ok(updated.includes("Result: |"), "Result block untouched");
});
check("unparseable gate edit writes nothing and marks the card", () => {
  const previous = makeCanvas();
  const next = clone(previous);
  next.nodes[2].text = "Disposition = 30\nJournal";
  const notes = makeNotes();
  const { plan } = runSync(previous, next, notes);
  assert.equal(plan.noteUpdates.size, 0);
  assert.equal(plan.failures.length, 1);
  assert.ok(applySyncPlanToCanvas(next, plan));
  const gate = next.nodes[2];
  assert.ok(gate.text.startsWith("\u26A0\uFE0F"));
  assert.ok(gate.text.endsWith("Disposition = 30\nJournal"), "user text preserved below the warning");
  assert.equal(editableCardText(gate.text), "Disposition = 30\nJournal");
});
check("result edit does line surgery and preserves Choice lines and block style", () => {
  const previous = makeCanvas();
  const next = clone(previous);
  next.nodes[4].text = 'MessageBox "custom line"\nJournal TestQuest 10';
  const notes = makeNotes();
  const { plan } = runSync(previous, next, notes);
  assert.equal(plan.failures.length, 0);
  const updated = plan.noteUpdates.get(BRANCH_PATH);
  const expectedResult = [
    "Result: |",
    '  MessageBox "custom line"',
    '  Journal "TestQuest" 10',
    '  Choice "Yes." 1 "No." 2'
  ].join("\n");
  assert.ok(updated.includes(expectedResult), `Result block:
${updated}`);
  assert.ok(!updated.includes("Goodbye"));
  assert.ok(updated.includes("MyCustomKey: keep me"));
  assert.equal(plan.cardUpdates.get("r1"), 'MessageBox "custom line"\nJournal [[10|TestQuest 10]]');
});
check("single-line result stays in the inline scalar style", () => {
  const previous = makeCanvas();
  previous.nodes.push({
    id: "r2",
    type: "text",
    text: "Goodbye",
    x: 0,
    y: 0,
    width: 440,
    height: 50,
    color: "5",
    espCard: meta("result", INLINE_PATH)
  });
  const next = clone(previous);
  next.nodes.find((n) => n.id === "r2").text = "ModDisposition -10";
  const { plan } = runSync(previous, next, makeNotes());
  const updated = plan.noteUpdates.get(INLINE_PATH);
  assert.ok(updated.includes("\nResult: ModDisposition -10\n"), `inline style kept:
${updated}`);
});
check("choice rename rewrites only its pair in the Choice line", () => {
  const previous = makeCanvas();
  const next = clone(previous);
  next.nodes[5].text = "Yes, take it.";
  const notes = makeNotes();
  const { plan } = runSync(previous, next, notes);
  assert.equal(plan.failures.length, 0);
  const updated = plan.noteUpdates.get(BRANCH_PATH);
  assert.ok(updated.includes('  Choice "Yes, take it." 1 "No." 2'), updated);
  assert.equal(plan.cardUpdates.get("c1"), "Yes, take it.");
});
check("choice rename with quotes is rejected without writing", () => {
  const previous = makeCanvas();
  const next = clone(previous);
  next.nodes[5].text = 'Say "hello"';
  const { plan } = runSync(previous, next, makeNotes());
  assert.equal(plan.noteUpdates.size, 0);
  assert.equal(plan.failures.length, 1);
});
check("quest context comes from journal nodes", () => {
  const canvas = makeCanvas();
  const notes = makeNotes();
  const context = deriveQuestContext(canvas, (path) => notes.get(path) ?? null);
  assert.deepEqual(context.questIds, ["TestQuest"]);
  assert.deepEqual(context.milestones.map((m) => m.index), [10, 20]);
});
check("sync converges: echo produces no further edits and writes reach a fixed point", () => {
  const previous = makeCanvas();
  const next = clone(previous);
  next.nodes[2].text = "Disposition = 30\nJournal TestQuest=20\nDead kashtes ilabael > 0\nPCLevel > 5";
  const notes = makeNotes();
  const { plan } = runSync(previous, next, notes);
  for (const [path, content] of plan.noteUpdates) {
    notes.set(path, content);
  }
  applySyncPlanToCanvas(next, plan);
  const rerun = runSync(next, clone(next), notes);
  assert.equal(rerun.edits.length, 0);
  const echoEdit = clone(next);
  echoEdit.nodes[2].text = `${plan.cardUpdates.get("g1")} `;
  const second = runSync(next, echoEdit, notes);
  for (const [path, content] of second.plan.noteUpdates) {
    notes.set(path, content);
  }
  assert.equal(second.plan.cardUpdates.get("g1"), plan.cardUpdates.get("g1"), "echo text is stable");
  const echoEdit2 = clone(echoEdit);
  echoEdit2.nodes[2].text = `${plan.cardUpdates.get("g1")}  `;
  const third = runSync(echoEdit, echoEdit2, notes);
  assert.equal(third.plan.noteUpdates.size, 0, "second application is byte-stable");
});
function edgeGestureRun(previous, next, notes) {
  const readNote = (path) => notes.get(path) ?? null;
  const context = deriveQuestContext(next, readNote);
  const edits = diffCanvasEdgeGestures(previous, next, context);
  return { edits, planFor: (subset) => planEdgeGestures(subset, readNote, context, next) };
}
check("edge add: dialogue -> journal writes the Journal result line", () => {
  const previous = makeCanvas();
  const next = clone(previous);
  next.edges.push({ id: "e-adv", fromNode: "d1", fromSide: "right", toNode: "j10", toSide: "left" });
  const notes = makeNotes();
  const { edits, planFor } = edgeGestureRun(previous, next, notes);
  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0].gesture, {
    type: "journal-advance",
    sourceFile: BRANCH_PATH,
    questId: "TestQuest",
    index: 10
  });
  const plan = planFor(edits);
  const updated = plan.noteUpdates.get(BRANCH_PATH);
  assert.ok(updated.includes('  Journal "TestQuest" 10'), updated);
  assert.ok(!updated.includes('Journal "TestQuest" 20'));
  assert.ok(plan.cardUpdates.get("r1").includes("Journal [[10|TestQuest 10]]"));
});
check("edge remove: dialogue -> journal deletes the Journal result line", () => {
  const previous = makeCanvas();
  previous.edges.push({ id: "e-adv", fromNode: "d1", fromSide: "right", toNode: "j20", toSide: "left" });
  const next = clone(previous);
  next.edges = [];
  const notes = makeNotes();
  const { edits, planFor } = edgeGestureRun(previous, next, notes);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].kind, "remove");
  assert.equal(
    describeEdgeGesture(edits[0]),
    `${BRANCH_PATH}: remove result line 'Journal "TestQuest" 20'`
  );
  const plan = planFor(edits);
  const updated = plan.noteUpdates.get(BRANCH_PATH);
  assert.ok(!updated.includes('Journal "TestQuest" 20'), updated);
  assert.ok(updated.includes('  Choice "Yes." 1 "No." 2'), "other lines untouched");
});
check("edge add: dialogue -> choice card ensures the Choice pair", () => {
  const previous = makeCanvas();
  previous.nodes.push({
    id: "d2",
    type: "file",
    file: INLINE_PATH,
    x: 0,
    y: 600,
    width: 440,
    height: 120,
    color: "3",
    espCard: meta("dialogue", INLINE_PATH)
  });
  const next = clone(previous);
  next.edges.push({ id: "e-offer", fromNode: "d2", fromSide: "right", toNode: "c1", toSide: "left" });
  const notes = makeNotes();
  const { edits, planFor } = edgeGestureRun(previous, next, notes);
  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0].gesture, {
    type: "offer-choice",
    sourceFile: INLINE_PATH,
    choiceValue: 1,
    prompt: "Yes."
  });
  const plan = planFor(edits);
  const updated = plan.noteUpdates.get(INLINE_PATH);
  assert.ok(updated.includes("Result: |"), "inline scalar grows into a block");
  assert.ok(updated.includes('  Choice "Yes." 1'), updated);
});
check("edge remove: dialogue -> choice card removes only that pair", () => {
  const previous = makeCanvas();
  previous.edges.push({ id: "e-offer", fromNode: "d1", fromSide: "right", toNode: "c1", toSide: "left" });
  const next = clone(previous);
  next.edges = [];
  const notes = makeNotes();
  const { edits, planFor } = edgeGestureRun(previous, next, notes);
  const plan = planFor(edits);
  const updated = plan.noteUpdates.get(BRANCH_PATH);
  assert.ok(updated.includes('Choice "No." 2'), "sibling pair kept");
  assert.ok(!updated.includes('"Yes." 1'), updated);
});
check("edge add/remove: choice card -> gate toggles the Choice filter", () => {
  const previous = makeCanvas();
  previous.nodes.push({
    id: "g2",
    type: "text",
    text: "Journal TestQuest = 10",
    x: 0,
    y: 600,
    width: 385,
    height: 60,
    color: "4",
    espCard: meta("gate", INLINE_PATH)
  });
  const next = clone(previous);
  next.edges.push({ id: "e-cg", fromNode: "c1", fromSide: "right", toNode: "g2", toSide: "left" });
  const notes = makeNotes();
  const { edits, planFor } = edgeGestureRun(previous, next, notes);
  assert.deepEqual(edits[0].gesture, { type: "choice-gate", targetFile: INLINE_PATH, choiceValue: 1 });
  const plan = planFor(edits);
  const updated = plan.noteUpdates.get(INLINE_PATH);
  assert.ok(updated.includes("Function1: Function"), updated);
  assert.ok(updated.includes("Variable1: Choice = 1"), updated);
  assert.equal(plan.cardUpdates.get("g2"), "Disposition = 0\nChoice = 1\nJournal TestQuest = 10");
  notes.set(INLINE_PATH, updated);
  const reverted = edgeGestureRun(next, previous, notes);
  assert.equal(reverted.edits[0].kind, "remove");
  const removePlan = reverted.planFor(reverted.edits);
  const restored = removePlan.noteUpdates.get(INLINE_PATH);
  assert.ok(!restored.includes("Choice = 1"), restored);
  assert.ok(restored.includes("Variable0: TestQuest = 10"), "journal filter kept");
});
check("edge add: journal -> gate adds the availability condition", () => {
  const previous = makeCanvas();
  const next = clone(previous);
  next.edges.push({ id: "e-avail", fromNode: "j20", fromSide: "right", toNode: "g1", toSide: "left" });
  const notes = makeNotes();
  const { edits, planFor } = edgeGestureRun(previous, next, notes);
  assert.deepEqual(edits[0].gesture, {
    type: "availability-gate",
    targetFile: BRANCH_PATH,
    questId: "TestQuest",
    index: 20
  });
  const plan = planFor(edits);
  const updated = plan.noteUpdates.get(BRANCH_PATH);
  assert.ok(updated.includes("Variable2: TestQuest = 20"), updated);
});
check("ambiguous and derived edges are ignored", () => {
  const previous = makeCanvas();
  const next = clone(previous);
  next.edges.push(
    // derived marker
    { id: "e-derived", fromNode: "d1", fromSide: "right", toNode: "j10", toSide: "left", espCard: { role: "derived", rev: 1 } },
    // user note endpoint
    { id: "e-user", fromNode: "user-note", fromSide: "right", toNode: "g1", toSide: "left" },
    // non-whitelisted role pair (gate -> journal)
    { id: "e-odd", fromNode: "g1", fromSide: "right", toNode: "j10", toSide: "left" },
    // journal -> dialogue is not a whitelisted gesture either
    { id: "e-jd", fromNode: "j10", fromSide: "right", toNode: "d1", toSide: "left" }
  );
  const notes = makeNotes();
  const { edits } = edgeGestureRun(previous, next, notes);
  assert.deepEqual(edits, []);
});
check("refresh keeps manual layout, remaps ids, and drops orphans", () => {
  const existing = makeCanvas();
  existing.nodes[2].x = 5e3;
  existing.nodes[2].y = -300;
  existing.nodes[3].x = 5600;
  existing.nodes.push({
    id: "orphan-gate",
    type: "text",
    text: "Dead someone > 0",
    x: 1,
    y: 1,
    width: 385,
    height: 60,
    espCard: meta("gate", "TES3 Plugins/Test/Topic/gone/gone ~1.md")
  });
  existing.edges.push({ id: "user-wire", fromNode: "user-note", fromSide: "right", toNode: "d1", toSide: "left" });
  const fresh = makeCanvas();
  fresh.nodes = fresh.nodes.filter((n) => n.id !== "user-note");
  const renamedChoice = fresh.nodes.find((n) => n.id === "c1");
  renamedChoice.id = "c1-renamed";
  renamedChoice.text = "Yes, absolutely.";
  const newGate = {
    id: "g-new",
    type: "text",
    text: "Choice = 2",
    x: 900,
    y: 340,
    width: 385,
    height: 60,
    espCard: meta("gate", "TES3 Plugins/Test/Topic/test topic/new.md")
  };
  fresh.nodes.push(newGate);
  fresh.edges.push({ id: "e-new", fromNode: "d1", fromSide: "right", toNode: "g-new", toSide: "left" });
  const { merged, stats } = mergeCanvasPreservingLayout(existing, fresh);
  const gate = merged.nodes.find((n) => n.id === "g1");
  assert.equal(gate.x, 5e3);
  assert.equal(gate.y, -300);
  const dialogue = merged.nodes.find((n) => n.id === "d1");
  assert.equal(dialogue.x, 5600);
  const choice = merged.nodes.find((n) => n.id === "c1-renamed");
  assert.ok(choice, "renamed choice card present");
  assert.equal(choice.text, "Yes, absolutely.");
  assert.equal(choice.x, 700, "kept the old choice card position");
  const placed = merged.nodes.find((n) => n.id === "g-new");
  assert.equal(placed.x, 5600 + (900 - 400));
  assert.equal(placed.y, 200 + (340 - 200));
  assert.ok(!merged.nodes.some((n) => n.id === "orphan-gate"));
  assert.ok(merged.nodes.some((n) => n.id === "user-note"));
  assert.ok(merged.edges.some((e) => e.id === "user-wire"));
  assert.deepEqual(stats, { matched: 6, added: 1, removed: 1, userNodesKept: 1, userEdgesKept: 1 });
});
console.log(`sync-test: ${testCount} checks passed`);
