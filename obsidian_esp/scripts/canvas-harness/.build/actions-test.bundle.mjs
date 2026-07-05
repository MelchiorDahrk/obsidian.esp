// scripts/canvas-harness/actions-test-entry.mjs
import assert from "node:assert/strict";

// obsidian_plugin/src/features/quest-canvas/card-meta.ts
var CARD_META_REV = 1;
function getCardMeta(node) {
  const meta2 = node.espCard;
  if (!meta2 || typeof meta2.role !== "string" || typeof meta2.rev !== "number") {
    return null;
  }
  return meta2;
}
function setCardMeta(node, meta2) {
  node.espCard = { ...meta2, rev: CARD_META_REV };
}

// obsidian_plugin/src/features/quest-canvas/model.ts
var DIALOGUE_COLOR = "3";
var GATE_COLOR = "4";
var GATE_WIDTH = 385;
var CHOICE_WIDTH = 320;
var DIALOGUE_WIDTH = 440;
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
function createNodeId(seed) {
  return stableHash(seed);
}
function createEdgeId(seed) {
  return stableHash(`edge:${seed}`);
}
function stableHash(value) {
  let left = 2166136261;
  let right = 16777619;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left ^= code;
    left = Math.imul(left, 16777619);
    right ^= code;
    right = Math.imul(right, 668265261);
  }
  const leftHex = (left >>> 0).toString(16).padStart(8, "0");
  const rightHex = (right >>> 0).toString(16).padStart(8, "0");
  return `${leftHex}${rightHex}`;
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
function frontmatterSection(content) {
  return content.match(/^---\n[\s\S]*?\n---(?:\n|$)/)?.[0] ?? "";
}

// obsidian_plugin/src/features/quest-canvas/actions.ts
function emptyPlan() {
  return {
    noteUpdates: /* @__PURE__ */ new Map(),
    noteCreations: /* @__PURE__ */ new Map(),
    canvasInsertion: { nodes: [], edges: [] },
    cardUpdates: /* @__PURE__ */ new Map(),
    metaUpdates: /* @__PURE__ */ new Map()
  };
}
function frontmatterOf(content) {
  return parseStructuredFrontmatter(content.match(/^---\n[\s\S]*?\n---(?:\n|$)/)?.[0] ?? "");
}
function resultLinesOf(content) {
  return (getStringValue(frontmatterOf(content), "Result") ?? "").split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}
function pickFreeNotePath(folderPath, topic, existingPaths) {
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${folderPath}/${topic} ~${suffix}.md`;
    if (!existingPaths.has(candidate)) {
      return candidate;
    }
  }
}
function nodeById(canvas, nodeId) {
  return canvas.nodes.find((node) => node.id === nodeId);
}
function addPlannedEdge(insertion, canvas, seed, fromNode, toNode, label) {
  const id = createEdgeId(seed);
  if (canvas.edges.some((edge) => edge.id === id) || insertion.edges.some((edge) => edge.id === id)) {
    return;
  }
  insertion.edges.push({
    id,
    fromNode,
    fromSide: "right",
    toNode,
    toSide: "left",
    ...label ? { label } : {}
  });
}
function planAddChoiceBranch(args) {
  const prompt = args.prompt.trim();
  if (prompt.length === 0) {
    return { error: "Choice prompt cannot be empty." };
  }
  if (prompt.includes('"')) {
    return { error: "Choice prompts cannot contain double quotes." };
  }
  const parentNode = nodeById(args.canvas, args.parentNodeId);
  if (!parentNode) {
    return { error: "Parent dialogue node was not found on the canvas." };
  }
  const frontmatter = frontmatterOf(args.parentContent);
  const type = getStringValue(frontmatter, "Type") ?? "Topic";
  const topic = getStringValue(frontmatter, "Topic");
  if (!topic) {
    return { error: "Parent note has no Topic." };
  }
  const parentActions = parseResultActions(getStringValue(frontmatter, "Result") ?? "", args.context.questIds);
  const usedValues = parentActions.filter((action) => action.kind === "choice-set" && action.choiceValue !== void 0).map((action) => action.choiceValue);
  const choiceValue = usedValues.length > 0 ? Math.max(...usedValues) + 1 : 1;
  const plan = emptyPlan();
  const parentLines = resultLinesOf(args.parentContent);
  parentLines.push(`Choice "${prompt}" ${choiceValue}`);
  plan.noteUpdates.set(args.parentPath, setResultLines(args.parentContent, parentLines));
  const gateLines = [{ kind: "choice", choiceValue }];
  const parentConditions = parseConditions(frontmatter, args.context.questIds);
  for (const condition of parentConditions) {
    if (condition.kind === "journal" && condition.questId && args.context.questIds.includes(condition.questId)) {
      gateLines.push({
        kind: "filter",
        filterKind: "Journal",
        variable: `${condition.questId} ${condition.operator ?? "="} ${condition.value ?? 0}`
      });
    }
  }
  const folderPath = args.parentPath.slice(0, args.parentPath.lastIndexOf("/"));
  const newNotePath = pickFreeNotePath(folderPath, topic, args.existingNotePaths);
  const template = [
    "---",
    "Source:",
    `Type: ${type}`,
    `Topic: ${topic}`,
    "---",
    "",
    args.responseText.trim().length > 0 ? args.responseText.trim() : "New response.",
    ""
  ].join("\n");
  plan.noteCreations.set(newNotePath, applyGateLines(template, gateLines));
  const gateText = gateLines.map((line) => renderGateLine(line)).join("\n");
  const choiceDisplaySeed = `choice:${args.parentPath}:${choiceValue}:"${prompt}" - Choice ${choiceValue}`;
  const choiceX = parentNode.x + parentNode.width + 260;
  const choiceY = parentNode.y;
  const choiceNode = {
    id: createNodeId(choiceDisplaySeed),
    type: "text",
    text: prompt,
    x: choiceX,
    y: choiceY,
    width: CHOICE_WIDTH,
    height: measureTextHeight(prompt, CHOICE_WIDTH),
    color: GATE_COLOR
  };
  setCardMeta(choiceNode, { role: "choice", file: args.parentPath, choiceValue });
  const gateNode = {
    id: createNodeId(`gate:${newNotePath}`),
    type: "text",
    text: gateText,
    x: choiceX + CHOICE_WIDTH + 200,
    y: choiceY,
    width: GATE_WIDTH,
    height: measureTextHeight(gateText, GATE_WIDTH),
    color: GATE_COLOR
  };
  setCardMeta(gateNode, { role: "gate", file: newNotePath });
  const dialogueNode = {
    id: createNodeId(`dialogue:${newNotePath}`),
    type: "file",
    file: newNotePath,
    x: gateNode.x + GATE_WIDTH + 200,
    y: choiceY,
    width: DIALOGUE_WIDTH,
    height: 120,
    color: DIALOGUE_COLOR
  };
  setCardMeta(dialogueNode, { role: "dialogue", file: newNotePath });
  plan.canvasInsertion.nodes.push(choiceNode, gateNode, dialogueNode);
  addPlannedEdge(plan.canvasInsertion, args.canvas, `${args.parentNodeId}:${choiceNode.id}`, args.parentNodeId, choiceNode.id);
  addPlannedEdge(plan.canvasInsertion, args.canvas, `${choiceNode.id}:${gateNode.id}:${choiceValue}`, choiceNode.id, gateNode.id);
  addPlannedEdge(plan.canvasInsertion, args.canvas, `${gateNode.id}:${dialogueNode.id}`, gateNode.id, dialogueNode.id);
  const parentResultNode = args.canvas.nodes.find((node) => {
    const meta2 = getCardMeta(node);
    return meta2?.role === "result" && meta2.file === args.parentPath;
  });
  if (parentResultNode) {
    const rendered = renderCardFromNote(
      { role: "result", file: args.parentPath, rev: 1 },
      plan.noteUpdates.get(args.parentPath) ?? args.parentContent,
      args.context
    );
    if (rendered !== null) {
      plan.cardUpdates.set(parentResultNode.id, rendered);
    }
  }
  return plan;
}
function planAddSpeakerVariant(args) {
  const frontmatter = frontmatterOf(args.sourceContent);
  const topic = getStringValue(frontmatter, "Topic");
  if (!topic) {
    return { error: "Source note has no Topic." };
  }
  const plan = emptyPlan();
  const folderPath = args.sourcePath.slice(0, args.sourcePath.lastIndexOf("/"));
  const newNotePath = pickFreeNotePath(folderPath, topic, args.existingNotePaths);
  let variantContent = args.sourceContent;
  const nonSpeakerLines = parseConditions(frontmatter, args.context.questIds).filter((condition) => condition.kind !== "speaker");
  const gateLines = [];
  for (const condition of nonSpeakerLines) {
    const parsed = parseGateLine(condition.displayText);
    if (!("error" in parsed)) {
      gateLines.push(parsed);
    }
  }
  variantContent = applyGateLines(variantContent, gateLines);
  variantContent = variantContent.replace(/^DiagID:.*$/m, "DiagID:").replace(/^PrevID:.*$/m, "PrevID:");
  plan.noteCreations.set(newNotePath, variantContent);
  const sourceDialogueId = createNodeId(`dialogue:${args.sourcePath}`);
  const sourceNode = nodeById(args.canvas, sourceDialogueId);
  const baseX = sourceNode ? sourceNode.x : 0;
  const baseY = sourceNode ? sourceNode.y + sourceNode.height + 160 : 0;
  const gateText = gateLines.map((line) => renderGateLine(line)).join("\n");
  const gateNode = {
    id: createNodeId(`gate:${newNotePath}`),
    type: "text",
    text: gateText,
    x: baseX - GATE_WIDTH - 200,
    y: baseY,
    width: GATE_WIDTH,
    height: measureTextHeight(gateText.length > 0 ? gateText : " ", GATE_WIDTH),
    color: GATE_COLOR
  };
  setCardMeta(gateNode, { role: "gate", file: newNotePath });
  const dialogueNode = {
    id: createNodeId(`dialogue:${newNotePath}`),
    type: "file",
    file: newNotePath,
    x: baseX,
    y: baseY,
    width: DIALOGUE_WIDTH,
    height: 120,
    color: DIALOGUE_COLOR
  };
  setCardMeta(dialogueNode, { role: "dialogue", file: newNotePath });
  if (gateText.length > 0) {
    plan.canvasInsertion.nodes.push(gateNode);
    addPlannedEdge(plan.canvasInsertion, args.canvas, `${gateNode.id}:${dialogueNode.id}`, gateNode.id, dialogueNode.id);
  }
  plan.canvasInsertion.nodes.push(dialogueNode);
  return plan;
}
function planLinkJournalMilestone(args) {
  const plan = emptyPlan();
  const lines = resultLinesOf(args.dialogueContent);
  const journalLinePattern = new RegExp(`^Journal\\s+"?${args.questId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?\\s+-?\\d+$`, "i");
  const newLine = `Journal "${args.questId}" ${args.index}`;
  const existingIndex = lines.findIndex((line) => journalLinePattern.test(line));
  if (existingIndex === -1) {
    lines.push(newLine);
  } else if (lines[existingIndex] === newLine) {
    return { error: `Already advances ${args.questId} to ${args.index}.` };
  } else {
    lines[existingIndex] = newLine;
  }
  plan.noteUpdates.set(args.dialoguePath, setResultLines(args.dialogueContent, lines));
  const milestone = args.context.milestones.find(
    (candidate) => candidate.questId === args.questId && candidate.index === args.index
  );
  const journalNode = milestone ? args.canvas.nodes.find((node) => getCardMeta(node)?.role === "journal" && getCardMeta(node)?.file === milestone.file.path) : void 0;
  const dialogueNodeId = createNodeId(`dialogue:${args.dialoguePath}`);
  if (journalNode && nodeById(args.canvas, dialogueNodeId)) {
    addPlannedEdge(
      plan.canvasInsertion,
      args.canvas,
      `${dialogueNodeId}:${journalNode.id}:${args.index}`,
      dialogueNodeId,
      journalNode.id
    );
  }
  const resultNode = args.canvas.nodes.find((node) => {
    const meta2 = getCardMeta(node);
    return meta2?.role === "result" && meta2.file === args.dialoguePath;
  });
  if (resultNode) {
    const rendered = renderCardFromNote(
      { role: "result", file: args.dialoguePath, rev: 1 },
      plan.noteUpdates.get(args.dialoguePath) ?? args.dialogueContent,
      args.context
    );
    if (rendered !== null) {
      plan.cardUpdates.set(resultNode.id, rendered);
    }
  }
  return plan;
}
function planRenumberChoice(args) {
  if (!Number.isInteger(args.newValue)) {
    return { error: "Choice value must be an integer." };
  }
  if (args.newValue === args.oldValue) {
    return { error: "Choice value is unchanged." };
  }
  const parentFrontmatter = frontmatterOf(args.parentContent);
  const parentActions = parseResultActions(getStringValue(parentFrontmatter, "Result") ?? "", args.context.questIds);
  const usedValues = parentActions.filter((action) => action.kind === "choice-set" && action.choiceValue !== void 0).map((action) => action.choiceValue);
  if (!usedValues.includes(args.oldValue)) {
    return { error: `Parent has no Choice ${args.oldValue}.` };
  }
  if (usedValues.includes(args.newValue)) {
    return { error: `Choice ${args.newValue} is already used by this record.` };
  }
  const plan = emptyPlan();
  const parentLines = resultLinesOf(args.parentContent).map((line) => {
    if (!/^Choice\s/i.test(line)) {
      return line;
    }
    return line.replace(/"([^"]*)"(\s+)(-?\d+)/g, (pair, text, spacing, value) => Number.parseInt(value, 10) === args.oldValue ? `"${text}"${spacing}${args.newValue}` : pair);
  });
  plan.noteUpdates.set(args.parentPath, setResultLines(args.parentContent, parentLines));
  const choiceFilterPattern = new RegExp(`^(Variable\\d:\\s*Choice\\s*=\\s*)${args.oldValue}\\s*$`, "m");
  for (const [path, content] of args.topicNotes) {
    if (path === args.parentPath) {
      continue;
    }
    let next = content;
    while (choiceFilterPattern.test(next)) {
      next = next.replace(choiceFilterPattern, `$1${args.newValue}`);
    }
    if (next !== content) {
      plan.noteUpdates.set(path, next);
    }
  }
  for (const node of args.canvas.nodes) {
    const meta2 = getCardMeta(node);
    if (!meta2) {
      continue;
    }
    if (meta2.role === "choice" && meta2.file === args.parentPath && meta2.choiceValue === args.oldValue) {
      plan.metaUpdates.set(node.id, { ...meta2, choiceValue: args.newValue });
    }
    if (meta2.role === "gate" && meta2.file && plan.noteUpdates.has(meta2.file)) {
      const rendered = renderCardFromNote(meta2, plan.noteUpdates.get(meta2.file), args.context);
      if (rendered !== null) {
        plan.cardUpdates.set(node.id, rendered);
      }
    }
  }
  return plan;
}
function applyActionPlanToCanvas(canvas, plan) {
  let changed = false;
  const nodeIds = new Set(canvas.nodes.map((node) => node.id));
  for (const node of plan.canvasInsertion.nodes) {
    if (!nodeIds.has(node.id)) {
      canvas.nodes.push(node);
      nodeIds.add(node.id);
      changed = true;
    }
  }
  const edgeIds = new Set(canvas.edges.map((edge) => edge.id));
  for (const edge of plan.canvasInsertion.edges) {
    if (!edgeIds.has(edge.id)) {
      canvas.edges.push(edge);
      edgeIds.add(edge.id);
      changed = true;
    }
  }
  for (const [nodeId, text] of plan.cardUpdates) {
    const node = canvas.nodes.find((candidate) => candidate.id === nodeId);
    if (node && node.text !== text) {
      node.text = text;
      node.height = measureTextHeight(text, node.width);
      changed = true;
    }
  }
  for (const [nodeId, meta2] of plan.metaUpdates) {
    const node = canvas.nodes.find((candidate) => candidate.id === nodeId);
    if (node) {
      setCardMeta(node, meta2);
      changed = true;
    }
  }
  return changed;
}

// scripts/canvas-harness/actions-test-entry.mjs
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
var PARENT_PATH = "TES3 Plugins/Test/Topic/test topic/test topic ~1.md";
var JOURNAL_10_PATH = "TES3 Plugins/Test/Journal/TestQuest/10.md";
var JOURNAL_20_PATH = "TES3 Plugins/Test/Journal/TestQuest/20.md";
var PARENT_NOTE = [
  "---",
  "Source:",
  "Type: Topic",
  "Topic: test topic",
  "Disposition: 0",
  "ID: test npc",
  "Result: |",
  '  Choice "First option." 1',
  "  Goodbye",
  "Function0: Journal",
  "Variable0: TestQuest = 10",
  "---",
  "",
  "What do you want to do?"
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
    [PARENT_PATH, PARENT_NOTE],
    [JOURNAL_10_PATH, journalNote(10)],
    [JOURNAL_20_PATH, journalNote(20)]
  ]);
}
var meta = (role, file, extra = {}) => ({ role, file, rev: 1, ...extra });
function makeCanvas() {
  return {
    nodes: [
      { id: "j10", type: "file", file: JOURNAL_10_PATH, x: 0, y: 0, width: 440, height: 100, color: "6", espCard: meta("journal", JOURNAL_10_PATH, { questId: "TestQuest" }) },
      { id: "j20", type: "file", file: JOURNAL_20_PATH, x: 2600, y: 0, width: 440, height: 100, color: "6", espCard: meta("journal", JOURNAL_20_PATH, { questId: "TestQuest" }) },
      { id: "d1", type: "file", file: PARENT_PATH, x: 600, y: 200, width: 440, height: 120, color: "3", espCard: meta("dialogue", PARENT_PATH) }
    ],
    edges: []
  };
}
function contextFor(canvas, notes) {
  return deriveQuestContext(canvas, (path) => notes.get(path) ?? null);
}
function frontmatterOf2(content) {
  return parseStructuredFrontmatter(content.match(/^---\n[\s\S]*?\n---(?:\n|$)/)?.[0] ?? "");
}
check("add choice branch, then link a journal milestone on the new response", () => {
  const notes = makeNotes();
  const canvas = makeCanvas();
  const context = contextFor(canvas, notes);
  const plan = planAddChoiceBranch({
    parentNodeId: "d1",
    parentPath: PARENT_PATH,
    parentContent: notes.get(PARENT_PATH),
    prompt: "I will take the job.",
    responseText: "Excellent. Bring me the lantern.",
    canvas,
    context,
    existingNotePaths: new Set(notes.keys())
  });
  assert.ok(!("error" in plan), JSON.stringify(plan));
  const parentUpdated = plan.noteUpdates.get(PARENT_PATH);
  assert.ok(parentUpdated.includes('  Choice "First option." 1'), parentUpdated);
  assert.ok(parentUpdated.includes('  Choice "I will take the job." 2'), parentUpdated);
  assert.equal(plan.noteCreations.size, 1);
  const [newPath, newContent] = [...plan.noteCreations][0];
  assert.equal(newPath, "TES3 Plugins/Test/Topic/test topic/test topic ~2.md");
  const newFrontmatter = frontmatterOf2(newContent);
  assert.equal(newFrontmatter["Function0"], "Function");
  assert.equal(newFrontmatter["Variable0"], "Choice = 2");
  assert.equal(newFrontmatter["Function1"], "Journal");
  assert.equal(newFrontmatter["Variable1"], "TestQuest = 10");
  assert.ok(newContent.includes("Excellent. Bring me the lantern."));
  const conditions = parseConditions(newFrontmatter, context.questIds);
  assert.ok(conditions.some((c) => c.kind === "choice" && c.choiceValue === 2));
  assert.ok(conditions.some((c) => c.kind === "journal" && c.questId === "TestQuest" && c.value === 10));
  assert.equal(plan.canvasInsertion.nodes.length, 3);
  const [choiceNode, gateNode, dialogueNode] = plan.canvasInsertion.nodes;
  assert.equal(choiceNode.espCard.role, "choice");
  assert.equal(choiceNode.espCard.choiceValue, 2);
  assert.equal(choiceNode.text, "I will take the job.");
  assert.equal(gateNode.espCard.role, "gate");
  assert.equal(gateNode.espCard.file, newPath);
  assert.equal(gateNode.text, "Choice = 2\nJournal TestQuest = 10");
  assert.equal(dialogueNode.espCard.role, "dialogue");
  assert.equal(plan.canvasInsertion.edges.length, 3);
  for (const [path, content] of plan.noteUpdates) notes.set(path, content);
  for (const [path, content] of plan.noteCreations) notes.set(path, content);
  assert.ok(applyActionPlanToCanvas(canvas, plan));
  const linkPlan = planLinkJournalMilestone({
    dialoguePath: newPath,
    dialogueContent: notes.get(newPath),
    questId: "TestQuest",
    index: 20,
    canvas,
    context: contextFor(canvas, notes)
  });
  assert.ok(!("error" in linkPlan), JSON.stringify(linkPlan));
  const advanced = linkPlan.noteUpdates.get(newPath);
  assert.ok(advanced.includes('Result: Journal "TestQuest" 20'), advanced);
  assert.equal(linkPlan.canvasInsertion.edges.length, 1);
  assert.equal(linkPlan.canvasInsertion.edges[0].toNode, "j20");
  for (const [path, content] of linkPlan.noteUpdates) notes.set(path, content);
  applyActionPlanToCanvas(canvas, linkPlan);
  const finalActions = parseResultActions(frontmatterOf2(notes.get(newPath))["Result"] ?? "", ["TestQuest"]);
  assert.ok(finalActions.some((a) => a.kind === "journal-set" && a.targetJournalIndex === 20));
});
check("linking the same milestone twice is rejected", () => {
  const notes = makeNotes();
  const canvas = makeCanvas();
  const context = contextFor(canvas, notes);
  const first = planLinkJournalMilestone({
    dialoguePath: PARENT_PATH,
    dialogueContent: notes.get(PARENT_PATH),
    questId: "TestQuest",
    index: 20,
    canvas,
    context
  });
  assert.ok(!("error" in first));
  const updated = first.noteUpdates.get(PARENT_PATH);
  const second = planLinkJournalMilestone({
    dialoguePath: PARENT_PATH,
    dialogueContent: updated,
    questId: "TestQuest",
    index: 20,
    canvas,
    context
  });
  assert.ok("error" in second);
});
check("add speaker variant duplicates the note minus speaker fields", () => {
  const notes = makeNotes();
  const canvas = makeCanvas();
  const plan = planAddSpeakerVariant({
    sourcePath: PARENT_PATH,
    sourceContent: notes.get(PARENT_PATH),
    canvas,
    context: contextFor(canvas, notes),
    existingNotePaths: new Set(notes.keys())
  });
  assert.ok(!("error" in plan), JSON.stringify(plan));
  const [, newContent] = [...plan.noteCreations][0];
  const fm = frontmatterOf2(newContent);
  assert.equal(fm["ID"], "", "speaker field blanked");
  assert.equal(fm["Function0"], "Journal", "journal gate kept");
  assert.equal(fm["Variable0"], "TestQuest = 10");
  assert.ok(newContent.includes("What do you want to do?"), "body kept");
  assert.ok(newContent.includes('Choice "First option." 1'), "results kept");
});
check("renumber choice rewrites parent pair and child filters", () => {
  const notes = makeNotes();
  const childPath = "TES3 Plugins/Test/Topic/test topic/test topic ~2.md";
  notes.set(childPath, [
    "---",
    "Type: Topic",
    "Topic: test topic",
    "Function0: Function",
    "Variable0: Choice = 1",
    "---",
    "",
    "Child response."
  ].join("\n"));
  const canvas = makeCanvas();
  canvas.nodes.push(
    { id: "c1", type: "text", text: "First option.", x: 0, y: 0, width: 320, height: 50, espCard: meta("choice", PARENT_PATH, { choiceValue: 1 }) },
    { id: "g2", type: "text", text: "Choice = 1", x: 0, y: 0, width: 385, height: 50, espCard: meta("gate", childPath) }
  );
  const plan = planRenumberChoice({
    parentPath: PARENT_PATH,
    parentContent: notes.get(PARENT_PATH),
    oldValue: 1,
    newValue: 5,
    topicNotes: notes,
    canvas,
    context: contextFor(canvas, notes)
  });
  assert.ok(!("error" in plan), JSON.stringify(plan));
  assert.ok(plan.noteUpdates.get(PARENT_PATH).includes('Choice "First option." 5'));
  assert.ok(plan.noteUpdates.get(childPath).includes("Variable0: Choice = 5"));
  assert.equal(plan.cardUpdates.get("g2"), "Choice = 5");
  assert.deepEqual(plan.metaUpdates.get("c1"), { role: "choice", file: PARENT_PATH, choiceValue: 5, rev: 1 });
  applyActionPlanToCanvas(canvas, plan);
  assert.equal(canvas.nodes.find((n) => n.id === "c1").espCard.choiceValue, 5);
});
check("renumber to an occupied value is rejected", () => {
  const notes = makeNotes();
  const withTwo = notes.get(PARENT_PATH).replace("  Goodbye", '  Choice "Second." 2\n  Goodbye');
  const plan = planRenumberChoice({
    parentPath: PARENT_PATH,
    parentContent: withTwo,
    oldValue: 1,
    newValue: 2,
    topicNotes: /* @__PURE__ */ new Map([[PARENT_PATH, withTwo]]),
    canvas: makeCanvas(),
    context: contextFor(makeCanvas(), notes)
  });
  assert.ok("error" in plan);
});
check("pickFreeNotePath skips occupied suffixes", () => {
  const existing = /* @__PURE__ */ new Set([
    "folder/topic ~1.md",
    "folder/topic ~2.md",
    "folder/topic ~4.md"
  ]);
  assert.equal(pickFreeNotePath("folder", "topic", existing), "folder/topic ~3.md");
});
console.log(`actions-test: ${testCount} checks passed`);
