// scripts/canvas-harness/harness-entry.mjs
import { promises as fs } from "node:fs";
import path from "node:path";

// scripts/canvas-harness/obsidian-stub.mjs
function normalizePath(path2) {
  const normalized = String(path2).replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\//, "").replace(/\/$/, "");
  return normalized.length > 0 ? normalized : "/";
}
var TAbstractFile = class {
  constructor() {
    this.path = "";
    this.name = "";
    this.parent = null;
    this.vault = null;
  }
};
var TFile = class extends TAbstractFile {
  constructor() {
    super();
    this.basename = "";
    this.extension = "";
  }
};
var TFolder = class extends TAbstractFile {
  constructor() {
    super();
    this.children = [];
  }
  isRoot() {
    return this.parent === null;
  }
};

// obsidian_plugin/src/features/path-manager.ts
var PathManager = class {
  constructor(outputFolder) {
    this.outputFolder = outputFolder;
  }
  /**
   * Returns the root folder for a specific plugin export.
   */
  getPluginDir(pluginName) {
    const baseName = pluginName.replace(/\.[^.]+$/, "");
    return normalizePath(`${this.outputFolder}/${baseName}`);
  }
  /**
   * Returns the path to a specific record type folder within a plugin.
   */
  getRecordTypeDir(pluginName, type) {
    return normalizePath(`${this.getPluginDir(pluginName)}/${type}`);
  }
  /**
   * Returns the path to a specific topic folder.
   */
  getTopicDir(pluginName, topicName) {
    return normalizePath(`${this.getRecordTypeDir(pluginName, "Topic" /* Topic */)}/${topicName}`);
  }
  /**
   * Returns the relative path for a file within the plugin directory.
   */
  getRelativePath(pluginName, file) {
    const pluginDir = this.getPluginDir(pluginName);
    if (file.path.startsWith(pluginDir)) {
      return file.path.substring(pluginDir.length + 1);
    }
    return file.path;
  }
  /**
   * Determines if a folder is a plugin root by checking for header.md.
   */
  static isPluginRoot(folder2) {
    const headerPath = normalizePath(`${folder2.path}/header.md`);
    return folder2.vault.getAbstractFileByPath(headerPath) instanceof TFile;
  }
  /**
   * Navigates up the folder hierarchy to find the plugin root.
   */
  static findPluginRoot(folder2) {
    let current = folder2;
    while (current) {
      if (this.isPluginRoot(current)) return current;
      current = current.parent;
    }
    return null;
  }
  /**
   * Resolves a list of relative project paths to absolute vault paths for a specific plugin.
   */
  resolveAbsolutePaths(pluginName, files) {
    const root = this.getPluginDir(pluginName);
    return files.map(([relativePath, content]) => [
      normalizePath(`${root}/${relativePath}`),
      content
    ]);
  }
};

// obsidian_plugin/src/utils/obsidian-utils.ts
function splitFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (match) {
    return {
      frontmatter: match[0],
      body: content.slice(match[0].length)
    };
  }
  return { frontmatter: "", body: content };
}

// obsidian_plugin/src/features/generate-quest-canvas.ts
var DIALOGUE_TYPES = ["Greeting", "Topic", "Persuasion", "Voice"];
var CANVAS_BODY_BLOCK_TYPES = /* @__PURE__ */ new Set(["Journal", "Greeting", "Topic"]);
var CANVAS_BODY_BLOCK_PREFIX = "obsidian-esp-canvas";
var QUEST_NAME_FIELD = "Quest Name";
var JOURNAL_FOLDER_NAME = "Journal";
var QUESTS_FOLDER_NAME = "Quests";
var DIALOGUE_COLOR = "3";
var GATE_COLOR = "4";
var RESULT_COLOR = "5";
var JOURNAL_COLOR = "6";
var JUMP_COLOR = "2";
var GATE_WIDTH = 385;
var CHOICE_WIDTH = 320;
var DIALOGUE_WIDTH = 440;
var JOURNAL_WIDTH = 440;
var JUMP_WIDTH = 128;
var FILE_NODE_MIN_HEIGHT = 96;
var FILE_NODE_PADDING_Y = 40;
var TEXT_NODE_HORIZONTAL_PADDING = 48;
var APPROX_TEXT_CHAR_WIDTH = 8;
var PHASE_GAP_X = 1320;
var GATE_GAP_X = 520;
var DIALOGUE_GAP_X = 980;
var CHOICE_GAP_X = 1580;
var LANE_GAP_Y = 560;
var RESULT_GAP_Y = 30;
var TOPIC_SEGMENT_GAP_X = 1920;
var FOLLOWUP_GROUP_GAP_X = 500;
var CLUSTER_GAP_Y = 140;
var DENSE_VARIANT_GAP_Y = 64;
var INTRODUCER_ORIGIN_X = -GATE_GAP_X;
var MIN_HORIZONTAL_EDGE_GAP_X = 75;
var LAYER_GAP_X = 180;
var LAYER_UNIT_GAP_Y = 160;
var CHOICE_STACK_GAP_Y = 24;
var SPACER_UNIT_SIZE = 110;
var SPACER_UNIT_GAP_Y = 70;
var PRE_JOURNAL_PHASE = 0;
var NUMERIC_OPERATOR_PATTERN = "(<=|>=|==|!=|=|<|>)";
async function discoverQuestScope(app2, folder2) {
  const projectRoot = PathManager.findPluginRoot(folder2);
  if (!projectRoot) {
    throw new Error("Could not find a valid obsidian.esp project root (missing header.md).");
  }
  const journalFolder = resolveJournalQuestFolder(folder2, projectRoot);
  if (!journalFolder) {
    throw new Error("Select a quest folder inside Journal/<QuestId>.");
  }
  const selectedDocs = await readFolderMarkdownDocuments(app2, journalFolder);
  const selectedQuestTitle = extractQuestTitle(selectedDocs) ?? journalFolder.name;
  const selectedQuestKey = normalizeQuestNameKey(selectedQuestTitle);
  const allJournalFolders = getImmediateChildFolders(projectRoot, JOURNAL_FOLDER_NAME);
  const linkedFolders = [journalFolder];
  if (selectedQuestKey !== null) {
    for (const sibling of allJournalFolders) {
      if (sibling.path === journalFolder.path) {
        continue;
      }
      const siblingDocs = await readFolderMarkdownDocuments(app2, sibling);
      const siblingTitle = extractQuestTitle(siblingDocs);
      if (!siblingTitle) {
        continue;
      }
      if (normalizeQuestNameKey(siblingTitle) === selectedQuestKey) {
        linkedFolders.push(sibling);
      }
    }
  }
  const journalDocuments = (await Promise.all(linkedFolders.map((childFolder) => readFolderMarkdownDocuments(app2, childFolder)))).flat();
  const rootJournalDocuments = journalDocuments.filter((document) => isQuestNameNote(document));
  const journalMilestones = journalDocuments.map((document) => toJournalMilestone(document)).filter((milestone) => milestone !== null).sort((left, right) => left.index - right.index || left.file.path.localeCompare(right.file.path));
  if (journalMilestones.length === 0) {
    throw new Error("No journal milestones with numeric Index values were found in the selected quest folder.");
  }
  const questIds = uniqueValues(journalDocuments.map((document) => getStringValue(document.frontmatter, "Topic")).filter((value) => Boolean(value)));
  const questsFolderPath = normalizePath(`${projectRoot.path}/${QUESTS_FOLDER_NAME}`);
  const outputCanvasPath = normalizePath(`${questsFolderPath}/${sanitizeFileName(selectedQuestTitle)}.canvas`);
  return {
    projectRoot,
    selectedFolder: journalFolder,
    questTitle: selectedQuestTitle,
    questKey: selectedQuestKey,
    questIds,
    journalFolders: linkedFolders,
    journalDocuments,
    journalMilestones,
    rootJournalDocuments,
    outputCanvasPath
  };
}
async function buildQuestCanvas(app2, scope2) {
  const dialogueDocuments = await readDialogueDocuments(app2, scope2.projectRoot);
  const allRecords = dialogueDocuments.map((document) => toDialogueRecord(document, scope2.questIds, scope2.journalMilestones.map((milestone) => milestone.index))).filter((record) => record !== null);
  const effectiveOwnership = resolveEffectiveQuestOwnership(allRecords);
  const directRelevant = new Set(
    allRecords.filter((record) => (effectiveOwnership.get(record.id) ?? []).some((questId) => scope2.questIds.includes(questId))).map((record) => record.id)
  );
  const relevantRecordIds = resolvePropagatedRelevantRecords(allRecords, directRelevant, scope2.questIds);
  const relevantRecords = allRecords.filter(
    (record) => relevantRecordIds.has(record.id) && !hasOnlyJournalResultsForOtherQuests(record, scope2.questIds)
  );
  if (relevantRecords.length === 0) {
    throw new Error("No quest-relevant dialogue notes were found for the selected journal folder.");
  }
  const milestoneIndices = uniqueNumbers(scope2.journalMilestones.map((milestone) => milestone.index).filter((index) => index > 0));
  const phaseIndices = milestoneIndices.length > 0 ? milestoneIndices : uniqueNumbers(scope2.journalMilestones.map((milestone) => milestone.index));
  const scopedRelevantRecords = relevantRecords.map((record) => {
    const phaseAnchor = determinePhaseAnchor(record.conditions, record.resultActions, phaseIndices, scope2.questIds);
    return {
      ...record,
      phaseAnchor,
      sourcePhaseAnchor: phaseAnchor
    };
  });
  const orderedRelevantRecords = assignDialogueInfoOrder(scopedRelevantRecords);
  const phaseAnchoredRecords = resolveChoiceDerivedPhaseAnchors(orderedRelevantRecords);
  const canvasRecords = stripUnrelatedAddTopicChoices(phaseAnchoredRecords);
  const families = groupBranchFamilies(canvasRecords, scope2.questIds);
  const warnings = [];
  const canvasContext = createCanvasLayoutContext();
  for (const document of scope2.journalDocuments) {
    canvasContext.fileBodyTextByPath.set(document.file.path, document.body);
  }
  for (const document of dialogueDocuments) {
    canvasContext.fileBodyTextByPath.set(document.file.path, document.body);
  }
  const phaseGraph = buildPhaseGraph(phaseIndices, families);
  const phaseXPositions = /* @__PURE__ */ new Map();
  const pendingPhaseEntryEdges = [];
  const milestonesByPhase = /* @__PURE__ */ new Map();
  for (const milestone of scope2.journalMilestones) {
    if (milestone.index <= 0) {
      continue;
    }
    const phaseMilestones = milestonesByPhase.get(milestone.index) ?? [];
    phaseMilestones.push(milestone);
    milestonesByPhase.set(milestone.index, phaseMilestones);
  }
  const computedPhasePositions = computePhasePositions(phaseGraph.orderedPhases, phaseGraph.segmentsByPhase);
  for (const [phaseValue, phaseX] of computedPhasePositions) {
    phaseXPositions.set(phaseValue, phaseX);
    const phaseMilestones = milestonesByPhase.get(phaseValue) ?? [];
    const phaseMilestone = phaseMilestones[0];
    if (!phaseMilestone) {
      continue;
    }
    addPhaseMilestone(canvasContext, phaseValue, phaseMilestone, phaseX);
  }
  for (let phaseIndex = 0; phaseIndex < phaseGraph.orderedPhases.length; phaseIndex += 1) {
    const phaseValue = phaseGraph.orderedPhases[phaseIndex] ?? 0;
    const phaseX = phaseXPositions.get(phaseValue) ?? 0;
    const phaseMilestones = milestonesByPhase.get(phaseValue) ?? [];
    const phaseMilestone = phaseMilestones[0];
    const milestoneNodeId = phaseMilestone ? contextPhaseNodeId(canvasContext, phaseValue) : void 0;
    const phaseSegments = phaseGraph.segmentsByPhase.get(phaseValue) ?? [];
    let topicSegmentIndex = 0;
    const phaseCenters = [];
    for (const segment of phaseSegments) {
      const topicBaseX = phaseX + GATE_GAP_X + topicSegmentIndex * TOPIC_SEGMENT_GAP_X;
      const topicLayout = layoutTopicFamilies(
        canvasContext,
        segment.families,
        phaseValue,
        topicBaseX,
        scope2.journalMilestones
      );
      if (milestoneNodeId) {
        for (const entryId of topicLayout.rootEntryIds) {
          if (!entryCanFollowPhaseMilestone(entryId, segment.families, canvasContext, phaseValue, scope2.questIds)) {
            continue;
          }
          pendingPhaseEntryEdges.push({
            phaseNodeId: milestoneNodeId,
            phaseValue,
            entryId,
            families: segment.families
          });
        }
      }
      if (Number.isFinite(topicLayout.topY) && Number.isFinite(topicLayout.bottomY)) {
        phaseCenters.push(topicLayout.mainLaneCenterY);
      }
      topicSegmentIndex += 1;
    }
    const phaseCenterY = phaseCenters.length > 0 ? Math.round(phaseCenters.reduce((sum, value) => sum + value, 0) / phaseCenters.length) : 0;
    if (milestoneNodeId) {
      centerPhaseMilestone(canvasContext, phaseValue, phaseCenterY);
    }
  }
  connectChoiceTransitions(canvasContext, canvasRecords);
  routeJournalRangeChoiceTransitions(canvasContext, canvasRecords);
  connectAddTopicTransitions(canvasContext, canvasRecords);
  connectBodyTopicLinkTransitions(canvasContext, canvasRecords);
  connectPendingPhaseEntryEdges(canvasContext, pendingPhaseEntryEdges);
  connectJournalConditionMilestones(canvasContext, canvasRecords, scope2.journalMilestones, scope2.questIds);
  connectAdjacentJournalPhaseTerminalTransitions(canvasContext, canvasRecords, phaseIndices, scope2.questIds);
  connectScriptedMilestones(canvasContext, phaseGraph.orderedPhases);
  applyLayeredCanvasLayout(canvasContext);
  normalizeCanvasOrigin(canvasContext);
  const relatedFiles = /* @__PURE__ */ new Map();
  const fileNodeTargets = /* @__PURE__ */ new Map();
  for (const milestone of scope2.journalDocuments) {
    relatedFiles.set(milestone.file.path, milestone.file);
  }
  for (const record of canvasRecords) {
    relatedFiles.set(record.file.path, record.file);
  }
  for (const milestone of scope2.journalMilestones) {
    if (!milestone.canvasSubpath) {
      continue;
    }
    fileNodeTargets.set(milestone.file.path, {
      file: milestone.file,
      subpath: milestone.canvasSubpath
    });
  }
  for (const record of canvasRecords) {
    if (!record.canvasSubpath) {
      continue;
    }
    fileNodeTargets.set(record.file.path, {
      file: record.file,
      subpath: record.canvasSubpath
    });
  }
  return {
    nodes: canvasContext.nodes,
    edges: canvasContext.edges,
    relatedFiles: [...relatedFiles.values()].sort((left, right) => left.path.localeCompare(right.path)),
    fileNodeTargets: [...fileNodeTargets.values()].sort((left, right) => left.file.path.localeCompare(right.file.path)),
    warnings
  };
}
function createCanvasLayoutContext() {
  return {
    nodes: [],
    edges: [],
    relatedFiles: /* @__PURE__ */ new Map(),
    fileBodyTextByPath: /* @__PURE__ */ new Map(),
    phaseNodeIds: /* @__PURE__ */ new Map(),
    recordEntryNodeIds: /* @__PURE__ */ new Map(),
    choiceTransitionAnchors: [],
    nodeIds: /* @__PURE__ */ new Set(),
    edgeIds: /* @__PURE__ */ new Set(),
    phaseIncomingCounts: /* @__PURE__ */ new Map(),
    phaseOutgoingCounts: /* @__PURE__ */ new Map()
  };
}
function contextPhaseNodeId(context, phaseValue) {
  return context.phaseNodeIds.get(phaseValue);
}
function entryCanFollowPhaseMilestone(entryId, families, context, phaseValue, questIds) {
  const entryRecords = families.flatMap((family) => family.records).filter(
    (record) => context.recordEntryNodeIds.get(record.id) === entryId
  );
  if (entryRecords.length === 0) {
    return true;
  }
  return entryRecords.some((record) => recordCanRunAtPhase(record, phaseValue, questIds));
}
function recordCanRunAtPhase(record, phaseValue, questIds) {
  const selectedQuestJournalConditions = record.conditions.filter(
    (condition) => condition.kind === "journal" && condition.questId !== void 0 && questIds.includes(condition.questId)
  );
  if (selectedQuestJournalConditions.length === 0) {
    return false;
  }
  return selectedQuestJournalConditions.every((condition) => journalConditionMatches(phaseValue, condition));
}
function connectPendingPhaseEntryEdges(context, pendingEdges) {
  const orderedEdges = [...pendingEdges].sort(
    (left, right) => Number(pendingPhaseEntryHasChoiceCondition(left, context)) - Number(pendingPhaseEntryHasChoiceCondition(right, context)) || left.phaseValue - right.phaseValue || left.entryId.localeCompare(right.entryId)
  );
  for (const pendingEdge of orderedEdges) {
    if (nodeCanReach(context, pendingEdge.phaseNodeId, pendingEdge.entryId)) {
      continue;
    }
    addEdge(
      context,
      `${pendingEdge.phaseNodeId}:${pendingEdge.entryId}`,
      pendingEdge.phaseNodeId,
      "right",
      pendingEdge.entryId,
      "left"
    );
  }
}
function pendingPhaseEntryHasChoiceCondition(pendingEdge, context) {
  return pendingEdge.families.flatMap((family) => family.records).some((record) => context.recordEntryNodeIds.get(record.id) === pendingEdge.entryId && record.conditions.some((condition) => condition.kind === "choice"));
}
function connectJournalConditionMilestones(context, records, milestones, questIds) {
  const orderedRecords = [...records].sort((left, right) => Number(recordHasChoiceCondition(left)) - Number(recordHasChoiceCondition(right)) || left.sourcePhaseAnchor - right.sourcePhaseAnchor || left.infoOrder - right.infoOrder || left.file.path.localeCompare(right.file.path));
  for (const record of orderedRecords) {
    const entryNodeId = context.recordEntryNodeIds.get(record.id);
    if (!entryNodeId) {
      continue;
    }
    for (const phaseValue of linkedJournalConditionPhases(record.conditions, milestones, questIds)) {
      const phaseNodeId = context.phaseNodeIds.get(phaseValue);
      if (!phaseNodeId) {
        continue;
      }
      if (nodeCanReach(context, phaseNodeId, entryNodeId)) {
        continue;
      }
      addEdge(context, `${phaseNodeId}:${entryNodeId}`, phaseNodeId, "right", entryNodeId, "left");
    }
  }
}
function recordHasChoiceCondition(record) {
  return record.conditions.some((condition) => condition.kind === "choice");
}
function addPhaseMilestone(context, phaseValue, milestone, phaseX) {
  const nodeId = createNodeId(`journal:${milestone.file.path}`);
  if (!context.nodeIds.has(nodeId)) {
    const height = measureFileNodeHeight(context, milestone.file.path, JOURNAL_WIDTH);
    context.nodes.push({
      id: nodeId,
      type: "file",
      file: milestone.file.path,
      subpath: milestone.canvasSubpath ?? void 0,
      x: phaseX,
      y: 0,
      width: JOURNAL_WIDTH,
      height,
      color: JOURNAL_COLOR
    });
    context.nodeIds.add(nodeId);
  }
  context.phaseNodeIds.set(phaseValue, nodeId);
  context.relatedFiles.set(milestone.file.path, milestone.file);
  return nodeId;
}
function centerPhaseMilestone(context, phaseValue, centerY) {
  const nodeId = context.phaseNodeIds.get(phaseValue);
  if (!nodeId) {
    return;
  }
  const node = context.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return;
  }
  node.y = Math.round(centerY - node.height / 2);
}
function layoutBranchFamily(context, family, phaseValue, gateX, dialogueX, choiceX, startY, allMilestones, clusterGapY = CLUSTER_GAP_Y) {
  const familyRecords = [...family.records].sort(compareDialogueRecords);
  const familyChoiceActions = family.results.filter((action) => action.kind === "choice-set");
  const choiceAnchors = [];
  let currentY = startY;
  let firstEntryId = "";
  for (let recordIndex = 0; recordIndex < familyRecords.length; recordIndex += 1) {
    const record = familyRecords[recordIndex];
    if (!record) {
      continue;
    }
    const gateText = renderConditionBlock(record.conditions);
    const gateHeight = gateText.length > 0 ? measureTextHeight(gateText, GATE_WIDTH) : 0;
    const dialogueHeight = measureCanvasBodyHeight(record.bodyText, DIALOGUE_WIDTH);
    const localResultLines = record.resultActions.filter((action) => action.kind !== "choice-set").map((action) => renderResultAction(action, allMilestones));
    const localResultHeight = localResultLines.length > 0 ? measureTextHeight(localResultLines.join("\n"), DIALOGUE_WIDTH) + RESULT_GAP_Y : 0;
    const choiceActions = familyChoiceActions.filter((action) => action.choiceValue !== void 0);
    const choiceHeights = choiceActions.map((action) => measureTextHeight(action.displayText, CHOICE_WIDTH));
    const choiceStackHeight = choiceHeights.reduce((total, height, index) => {
      const spacing = index === 0 ? 0 : 24;
      return total + spacing + height;
    }, 0);
    const clusterHeight = Math.max(gateHeight, dialogueHeight, choiceStackHeight) + localResultHeight + clusterGapY;
    const recordY = currentY;
    const dialogueId = addFileNode(
      context,
      `dialogue:${record.file.path}`,
      record.file.path,
      dialogueX,
      recordY,
      DIALOGUE_WIDTH,
      dialogueHeight,
      DIALOGUE_COLOR,
      record.canvasSubpath
    );
    const gateY = Math.round(recordY + Math.max(0, (dialogueHeight - gateHeight) / 2));
    const gateId = gateText.length > 0 ? addTextNode(
      context,
      `gate:${record.file.path}`,
      gateText,
      gateX,
      gateY,
      GATE_WIDTH,
      GATE_COLOR
    ) : dialogueId;
    context.relatedFiles.set(record.file.path, record.file);
    if (firstEntryId.length === 0) {
      firstEntryId = gateId;
    }
    context.recordEntryNodeIds.set(record.id, gateId);
    if (gateId !== dialogueId) {
      addEdge(context, `${gateId}:${dialogueId}`, gateId, "right", dialogueId, "left");
    }
    if (localResultLines.length > 0) {
      const resultText = localResultLines.join("\n");
      const resultId = addTextNode(
        context,
        `result:${record.file.path}`,
        resultText,
        dialogueX,
        recordY + dialogueHeight + RESULT_GAP_Y,
        DIALOGUE_WIDTH,
        containsJournalLine(localResultLines) ? JOURNAL_COLOR : RESULT_COLOR
      );
      addEdge(context, `${dialogueId}:${resultId}`, dialogueId, "bottom", resultId, "top");
    }
    for (const action of record.resultActions) {
      if (action.kind !== "journal-set" || action.targetJournalIndex === void 0) {
        continue;
      }
      const targetMilestone = resolveJournalResultMilestone(action, allMilestones);
      if (!targetMilestone) {
        continue;
      }
      const targetPhaseId = context.phaseNodeIds.get(targetMilestone.index);
      if (!targetPhaseId) {
        continue;
      }
      addEdge(context, `${dialogueId}:${targetPhaseId}:${action.targetJournalIndex}`, dialogueId, "right", targetPhaseId, "left");
      incrementPhaseCount(context.phaseOutgoingCounts, phaseValue);
      incrementPhaseCount(context.phaseIncomingCounts, targetMilestone.index);
    }
    let choiceCursorY = recordY + Math.max(0, Math.round((dialogueHeight - choiceStackHeight) / 2));
    const recordChoiceNodeIds = /* @__PURE__ */ new Map();
    for (let choiceIndex = 0; choiceIndex < choiceActions.length; choiceIndex += 1) {
      const choiceAction = choiceActions[choiceIndex];
      const choiceHeight = choiceHeights[choiceIndex] ?? measureTextHeight(choiceAction?.displayText ?? "", CHOICE_WIDTH);
      if (!choiceAction || choiceAction.choiceValue === void 0) {
        continue;
      }
      const choiceNodeKey = choiceActionIdentity(choiceAction);
      let choiceNodeId = recordChoiceNodeIds.get(choiceNodeKey);
      if (!choiceNodeId) {
        choiceNodeId = addTextNode(
          context,
          `choice:${record.file.path}:${choiceAction.choiceValue}:${choiceAction.displayText}`,
          choiceAction.displayText,
          choiceX,
          choiceCursorY,
          CHOICE_WIDTH,
          GATE_COLOR
        );
        recordChoiceNodeIds.set(choiceNodeKey, choiceNodeId);
        choiceAnchors.push({
          choiceValue: choiceAction.choiceValue,
          nodeId: choiceNodeId,
          x: choiceX,
          y: Math.round(choiceCursorY + choiceHeight / 2)
        });
        context.choiceTransitionAnchors.push({
          topic: family.topic,
          choiceValue: choiceAction.choiceValue,
          nodeId: choiceNodeId,
          sourceRecords: [record]
        });
        choiceCursorY += choiceHeight + 24;
      }
      addEdge(context, `${dialogueId}:${choiceNodeId}`, dialogueId, "right", choiceNodeId, "left");
    }
    currentY += clusterHeight;
  }
  return {
    firstEntryId,
    nextY: currentY,
    choiceAnchors
  };
}
function layoutTopicFamilies(context, families, phaseValue, topicBaseX, allMilestones) {
  const choiceGroups = groupFamiliesByPrimaryChoice(families);
  if (choiceGroups.length === 0) {
    return { rootEntryIds: [], topY: 0, bottomY: 0, mainLaneCenterY: 0, nodeIds: [] };
  }
  const groupsByChoice = mapChoiceGroupsByChoice(choiceGroups);
  let rootGroups = resolveRootChoiceGroups(choiceGroups);
  if (rootGroups.length === 0) {
    rootGroups = [...choiceGroups];
  }
  rootGroups = orderChoiceGroupsForLanes(rootGroups, phaseValue);
  const renderedGroupLayouts = /* @__PURE__ */ new Map();
  const renderingGroups = /* @__PURE__ */ new Set();
  const rootEntryIds = [];
  let topicTopY = Number.POSITIVE_INFINITY;
  let topicBottomY = Number.NEGATIVE_INFINITY;
  const renderChoiceGroup = (group, gateX, startY) => {
    const groupKey = choiceGroupKey(group.choiceValue);
    const cachedLayout = renderedGroupLayouts.get(groupKey);
    if (cachedLayout) {
      return cachedLayout;
    }
    if (renderingGroups.has(groupKey)) {
      return { rootEntryIds: [], topY: startY, bottomY: startY, mainLaneCenterY: startY, nodeIds: [] };
    }
    renderingGroups.add(groupKey);
    const renderedNodeCount = context.nodes.length;
    const dialogueX = gateX + (DIALOGUE_GAP_X - GATE_GAP_X);
    const choiceX = dialogueX + (CHOICE_GAP_X - DIALOGUE_GAP_X);
    let currentY = startY;
    let groupTopY = startY;
    let groupBottomY = startY;
    let localTopY = startY;
    let localBottomY = startY;
    const localEntryIds = [];
    const emittedAnchors = [];
    const childLayouts = [];
    const clusterGapY = choiceGroupUsesDenseVariantLayout(group) ? DENSE_VARIANT_GAP_Y : CLUSTER_GAP_Y;
    for (const family of [...group.families].sort(compareBranchFamilies)) {
      const familyLayout = layoutBranchFamily(
        context,
        family,
        phaseValue,
        gateX,
        dialogueX,
        choiceX,
        currentY,
        allMilestones,
        clusterGapY
      );
      localEntryIds.push(familyLayout.firstEntryId);
      emittedAnchors.push(...familyLayout.choiceAnchors);
      groupBottomY = Math.max(groupBottomY, familyLayout.nextY);
      localBottomY = Math.max(localBottomY, familyLayout.nextY);
      currentY = familyLayout.nextY;
    }
    const mainLaneBottomY = Math.max(groupTopY, groupBottomY - CLUSTER_GAP_Y);
    const mainLaneCenterY2 = Math.round((groupTopY + mainLaneBottomY) / 2);
    const mainColumnTopY = localTopY;
    const mainColumnBottomY = localBottomY;
    const anchoredChildLayouts = [];
    for (const anchor of collapseChoiceAnchors(emittedAnchors).sort((left, right) => left.y - right.y || left.choiceValue - right.choiceValue)) {
      const childGroup = groupsByChoice.get(choiceGroupKey(anchor.choiceValue));
      if (!childGroup) {
        continue;
      }
      const childGroupKey = choiceGroupKey(childGroup.choiceValue);
      const cachedChildLayout = renderedGroupLayouts.get(childGroupKey);
      if (cachedChildLayout) {
        childLayouts.push(cachedChildLayout);
        anchoredChildLayouts.push({
          choiceValue: anchor.choiceValue,
          anchorY: anchor.y,
          layout: cachedChildLayout
        });
        continue;
      }
      if (renderingGroups.has(childGroupKey)) {
        continue;
      }
      const childHeight = estimateChoiceGroupHeight(childGroup);
      const childStartY = Math.round(anchor.y - childHeight / 2);
      const childLayout = renderChoiceGroup(
        childGroup,
        anchor.x + FOLLOWUP_GROUP_GAP_X,
        childStartY
      );
      childLayouts.push(childLayout);
      anchoredChildLayouts.push({
        choiceValue: anchor.choiceValue,
        anchorY: anchor.y,
        layout: childLayout
      });
    }
    arrangeAnchoredChildLayouts(context, anchoredChildLayouts, CLUSTER_GAP_Y);
    localTopY = mainColumnTopY;
    localBottomY = mainColumnBottomY;
    for (const childLayout of childLayouts) {
      localTopY = Math.min(localTopY, childLayout.topY);
      localBottomY = Math.max(localBottomY, childLayout.bottomY);
    }
    topicTopY = Math.min(topicTopY, localTopY);
    topicBottomY = Math.max(topicBottomY, localBottomY);
    const layout = {
      rootEntryIds: localEntryIds,
      topY: localTopY,
      bottomY: localBottomY,
      mainLaneCenterY: mainLaneCenterY2,
      nodeIds: context.nodes.slice(renderedNodeCount).map((node) => node.id)
    };
    renderedGroupLayouts.set(groupKey, layout);
    renderingGroups.delete(groupKey);
    return layout;
  };
  const rootStartYs = buildCenteredGroupStartYs(rootGroups);
  const rootLayouts = [];
  for (let rootIndex = 0; rootIndex < rootGroups.length; rootIndex += 1) {
    const rootGroup = rootGroups[rootIndex];
    if (!rootGroup) {
      continue;
    }
    const rootLayout = renderChoiceGroup(rootGroup, topicBaseX, rootStartYs[rootIndex] ?? 0);
    rootEntryIds.push(...rootLayout.rootEntryIds);
    rootLayouts.push(rootLayout);
  }
  pushDownOverlappingLayouts(context, rootLayouts, LANE_GAP_Y);
  topicTopY = Number.POSITIVE_INFINITY;
  topicBottomY = Number.NEGATIVE_INFINITY;
  for (const rootLayout of rootLayouts) {
    topicTopY = Math.min(topicTopY, rootLayout.topY);
    topicBottomY = Math.max(topicBottomY, rootLayout.bottomY);
  }
  const layoutNodeIds = uniqueValues(rootLayouts.flatMap((layout) => layout.nodeIds));
  let nextFallbackY = Number.isFinite(topicBottomY) ? topicBottomY + LANE_GAP_Y : 0;
  for (const group of orderChoiceGroupsForLanes(choiceGroups, phaseValue)) {
    if (renderedGroupLayouts.has(choiceGroupKey(group.choiceValue))) {
      continue;
    }
    const fallbackLayout = renderChoiceGroup(group, topicBaseX, nextFallbackY);
    rootEntryIds.push(...fallbackLayout.rootEntryIds);
    rootLayouts.push(fallbackLayout);
    layoutNodeIds.push(...fallbackLayout.nodeIds.filter((nodeId) => !layoutNodeIds.includes(nodeId)));
    nextFallbackY = fallbackLayout.bottomY + LANE_GAP_Y;
  }
  const mainLaneCenterY = rootLayouts[0]?.mainLaneCenterY ?? 0;
  return {
    rootEntryIds: uniqueValues(rootEntryIds),
    topY: Number.isFinite(topicTopY) ? topicTopY : 0,
    bottomY: Number.isFinite(topicBottomY) ? topicBottomY : 0,
    mainLaneCenterY,
    nodeIds: layoutNodeIds
  };
}
function pushDownOverlappingLayouts(context, layouts, gapY) {
  const sortedLayouts = [...layouts].filter((layout) => layout.nodeIds.length > 0).sort((left, right) => left.topY - right.topY || left.bottomY - right.bottomY);
  let previousBottomY = null;
  for (const layout of sortedLayouts) {
    if (previousBottomY !== null) {
      const minimumTopY = previousBottomY + gapY;
      if (layout.topY < minimumTopY) {
        shiftTopicLayout(context, layout, minimumTopY - layout.topY);
      }
    }
    previousBottomY = layout.bottomY;
  }
}
function arrangeAnchoredChildLayouts(context, anchoredLayouts, gapY) {
  const orderedLayouts = [...anchoredLayouts].filter((item) => item.layout.nodeIds.length > 0).sort((left, right) => left.anchorY - right.anchorY || left.choiceValue - right.choiceValue);
  if (orderedLayouts.length === 0) {
    return;
  }
  const heights = orderedLayouts.map((item) => item.layout.bottomY - item.layout.topY);
  const cumulativeMinimumTops = [];
  let cumulativeTop = 0;
  for (let index = 0; index < orderedLayouts.length; index += 1) {
    cumulativeMinimumTops.push(cumulativeTop);
    cumulativeTop += (heights[index] ?? 0) + gapY;
  }
  const desiredOffsets = orderedLayouts.map((item, index) => {
    const minimumTop = cumulativeMinimumTops[index] ?? 0;
    const mainLaneOffset = item.layout.mainLaneCenterY - item.layout.topY;
    return item.anchorY - mainLaneOffset - minimumTop;
  });
  const compactOffsets = compactIncreasingOffsets(desiredOffsets);
  for (let index = 0; index < orderedLayouts.length; index += 1) {
    const item = orderedLayouts[index];
    if (!item) {
      continue;
    }
    const nextTop = Math.round((compactOffsets[index] ?? 0) + (cumulativeMinimumTops[index] ?? 0));
    shiftTopicLayout(context, item.layout, nextTop - item.layout.topY);
  }
}
function compactIncreasingOffsets(desiredOffsets) {
  const blocks = [];
  for (let index = 0; index < desiredOffsets.length; index += 1) {
    blocks.push({
      start: index,
      end: index,
      weight: 1,
      total: desiredOffsets[index] ?? 0
    });
    while (blocks.length >= 2) {
      const right = blocks[blocks.length - 1];
      const left = blocks[blocks.length - 2];
      if (!left || !right || left.total / left.weight <= right.total / right.weight) {
        break;
      }
      blocks.splice(blocks.length - 2, 2, {
        start: left.start,
        end: right.end,
        weight: left.weight + right.weight,
        total: left.total + right.total
      });
    }
  }
  const offsets = new Array(desiredOffsets.length);
  for (const block of blocks) {
    const value = block.total / block.weight;
    for (let index = block.start; index <= block.end; index += 1) {
      offsets[index] = value;
    }
  }
  return offsets;
}
function shiftTopicLayout(context, layout, deltaY) {
  if (deltaY === 0) {
    return;
  }
  const nodeIds = new Set(layout.nodeIds);
  for (const node of context.nodes) {
    if (nodeIds.has(node.id)) {
      node.y += deltaY;
    }
  }
  layout.topY += deltaY;
  layout.bottomY += deltaY;
  layout.mainLaneCenterY += deltaY;
}
function groupFamiliesByTopic(families) {
  const grouped = /* @__PURE__ */ new Map();
  for (const family of families) {
    const topicFamilies = grouped.get(family.topic) ?? [];
    topicFamilies.push(family);
    grouped.set(family.topic, topicFamilies);
  }
  return grouped;
}
function groupFamiliesByPrimaryChoice(families) {
  const grouped = /* @__PURE__ */ new Map();
  for (const family of families) {
    const choiceValues = family.records.map((record) => record.primaryChoiceValue).filter((value) => value !== null);
    const choiceValue = choiceValues.length > 0 ? Math.min(...choiceValues) : null;
    const key = choiceValue === null ? "root" : String(choiceValue);
    const existing = grouped.get(key);
    if (existing) {
      existing.families.push(family);
      continue;
    }
    grouped.set(key, { choiceValue, families: [family] });
  }
  return [...grouped.values()].sort(compareChoiceGroups);
}
function buildPhaseGraph(phaseIndices, families) {
  const phaseSet = new Set(phaseIndices);
  for (const family of families) {
    phaseSet.add(family.phaseAnchor);
  }
  const orderedPhaseValues = uniqueNumbers([...phaseSet]);
  const familiesByPhase = /* @__PURE__ */ new Map();
  const segmentsByPhase = /* @__PURE__ */ new Map();
  const incomingTransitions = /* @__PURE__ */ new Map();
  const outgoingTransitions = /* @__PURE__ */ new Map();
  const mainTargets = /* @__PURE__ */ new Map();
  for (const phaseValue of orderedPhaseValues) {
    familiesByPhase.set(phaseValue, []);
    segmentsByPhase.set(phaseValue, []);
    incomingTransitions.set(phaseValue, /* @__PURE__ */ new Set());
    outgoingTransitions.set(phaseValue, /* @__PURE__ */ new Set());
  }
  for (const family of families) {
    const phaseFamilies = familiesByPhase.get(family.phaseAnchor) ?? [];
    phaseFamilies.push(family);
    familiesByPhase.set(family.phaseAnchor, phaseFamilies);
    if (family.progressionTarget !== null && family.progressionTarget > family.phaseAnchor && phaseSet.has(family.progressionTarget)) {
      outgoingTransitions.get(family.phaseAnchor)?.add(family.progressionTarget);
      incomingTransitions.get(family.progressionTarget)?.add(family.phaseAnchor);
    }
  }
  for (const [phaseValue, phaseFamilies] of familiesByPhase) {
    const sortedFamilies = [...phaseFamilies].sort(compareBranchFamilies);
    familiesByPhase.set(phaseValue, sortedFamilies);
    segmentsByPhase.set(
      phaseValue,
      [...groupFamiliesByTopic(sortedFamilies).entries()].map(([topic, topicFamilies]) => ({
        topic,
        families: topicFamilies
      }))
    );
    mainTargets.set(
      phaseValue,
      sortedFamilies.map((family) => family.progressionTarget).find((target) => target !== null && target > phaseValue) ?? null
    );
  }
  return {
    orderedPhases: topologicallyOrderPhases(orderedPhaseValues, outgoingTransitions, incomingTransitions),
    familiesByPhase,
    segmentsByPhase,
    incomingTransitions,
    outgoingTransitions,
    mainTargets
  };
}
function topologicallyOrderPhases(phaseValues, outgoingTransitions, incomingTransitions) {
  const remainingIncoming = /* @__PURE__ */ new Map();
  const available = [...phaseValues].sort((left, right) => left - right);
  const ordered = [];
  for (const phaseValue of phaseValues) {
    remainingIncoming.set(phaseValue, incomingTransitions.get(phaseValue)?.size ?? 0);
  }
  const ready = available.filter((phaseValue) => (remainingIncoming.get(phaseValue) ?? 0) === 0);
  const queued = new Set(ready);
  while (ready.length > 0) {
    ready.sort((left, right) => left - right);
    const phaseValue = ready.shift();
    if (phaseValue === void 0) {
      break;
    }
    ordered.push(phaseValue);
    queued.delete(phaseValue);
    for (const target of [...outgoingTransitions.get(phaseValue) ?? []].sort((left, right) => left - right)) {
      const nextIncoming = Math.max(0, (remainingIncoming.get(target) ?? 0) - 1);
      remainingIncoming.set(target, nextIncoming);
      if (nextIncoming === 0 && !queued.has(target) && !ordered.includes(target)) {
        ready.push(target);
        queued.add(target);
      }
    }
  }
  for (const phaseValue of available) {
    if (!ordered.includes(phaseValue)) {
      ordered.push(phaseValue);
    }
  }
  return ordered;
}
function mapChoiceGroupsByChoice(choiceGroups) {
  const groupsByChoice = /* @__PURE__ */ new Map();
  for (const group of choiceGroups) {
    groupsByChoice.set(choiceGroupKey(group.choiceValue), group);
  }
  return groupsByChoice;
}
function collectEmittedChoices(families) {
  const emittedChoices = /* @__PURE__ */ new Set();
  for (const family of families) {
    for (const action of family.results) {
      if (action.kind === "choice-set" && action.choiceValue !== void 0) {
        emittedChoices.add(action.choiceValue);
      }
    }
  }
  return emittedChoices;
}
function resolveRootChoiceGroups(choiceGroups) {
  const emittedChoices = collectEmittedChoices(choiceGroups.flatMap((group) => group.families));
  return choiceGroups.filter(
    (group) => group.choiceValue === null || !emittedChoices.has(group.choiceValue)
  );
}
function orderChoiceGroupsForLanes(choiceGroups, phaseValue) {
  return [...choiceGroups].sort((left, right) => {
    const leftPriority = Math.min(...left.families.map((family) => family.priority), Number.MAX_SAFE_INTEGER);
    const rightPriority = Math.min(...right.families.map((family) => family.priority), Number.MAX_SAFE_INTEGER);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    const leftTarget = left.families.map((family) => family.progressionTarget).find((target) => target !== null && target > phaseValue) ?? null;
    const rightTarget = right.families.map((family) => family.progressionTarget).find((target) => target !== null && target > phaseValue) ?? null;
    return compareNullableNumbers(leftTarget, rightTarget) || compareChoiceGroups(left, right);
  });
}
function buildCenteredGroupStartYs(groups) {
  if (groups.length === 0) {
    return [];
  }
  const heights = groups.map((group) => estimateChoiceGroupHeight(group));
  const totalHeight = heights.reduce((sum, height, index) => {
    const spacing = index === 0 ? 0 : LANE_GAP_Y;
    return sum + spacing + height;
  }, 0);
  const startYs = new Array(groups.length);
  let cursorY = -Math.round(totalHeight / 2);
  for (let index = 0; index < groups.length; index += 1) {
    startYs[index] = cursorY;
    cursorY += (heights[index] ?? 0) + LANE_GAP_Y;
  }
  return startYs;
}
function choiceGroupUsesDenseVariantLayout(group) {
  return group.choiceValue === null && group.families.length >= 4 && group.families.every((family) => !family.results.some((action) => action.kind === "choice-set"));
}
function computePhasePositions(phaseIndices, segmentsByPhase) {
  const positions = /* @__PURE__ */ new Map();
  let currentX = 0;
  for (let index = 0; index < phaseIndices.length; index += 1) {
    const phaseValue = phaseIndices[index];
    if (phaseValue === void 0) {
      continue;
    }
    positions.set(phaseValue, currentX);
    const phaseWidth = estimatePhaseWidth(segmentsByPhase.get(phaseValue) ?? []);
    currentX += Math.max(PHASE_GAP_X, phaseWidth + 420);
  }
  return positions;
}
function estimatePhaseWidth(segments) {
  if (segments.length === 0) {
    return JOURNAL_WIDTH;
  }
  let furthestRight = JOURNAL_WIDTH;
  for (let topicIndex = 0; topicIndex < segments.length; topicIndex += 1) {
    const segment = segments[topicIndex];
    if (!segment) {
      continue;
    }
    const depth = estimateTopicDepth(segment.families);
    const topicBaseX = GATE_GAP_X + topicIndex * TOPIC_SEGMENT_GAP_X;
    const lastGateX = topicBaseX + (depth - 1) * sourceGroupStepX();
    const lastChoiceX = lastGateX + (CHOICE_GAP_X - GATE_GAP_X);
    furthestRight = Math.max(furthestRight, lastChoiceX + CHOICE_WIDTH);
  }
  return furthestRight;
}
function estimateChoiceGroupHeight(group) {
  if (group.families.length === 0) {
    return FILE_NODE_MIN_HEIGHT + CLUSTER_GAP_Y;
  }
  const clusterGapY = choiceGroupUsesDenseVariantLayout(group) ? DENSE_VARIANT_GAP_Y : CLUSTER_GAP_Y;
  return group.families.reduce((total, family) => total + estimateFamilyHeight(family, clusterGapY), 0);
}
function estimateFamilyHeight(family, clusterGapY = CLUSTER_GAP_Y) {
  let total = 0;
  for (const record of family.records) {
    const gateHeight = measureTextHeight(renderConditionBlock(record.conditions), GATE_WIDTH);
    const dialogueHeight = measureCanvasBodyHeight(record.bodyText, DIALOGUE_WIDTH);
    const localResultLines = record.resultActions.filter((action) => action.kind !== "choice-set").map((action) => action.displayText);
    const resultHeight = localResultLines.length > 0 ? measureTextHeight(localResultLines.join("\n"), DIALOGUE_WIDTH) + RESULT_GAP_Y : 0;
    total += Math.max(gateHeight, dialogueHeight) + resultHeight + clusterGapY;
  }
  return Math.max(total, FILE_NODE_MIN_HEIGHT + clusterGapY);
}
function estimateTopicDepth(families) {
  const choiceGroups = groupFamiliesByPrimaryChoice(families);
  if (choiceGroups.length === 0) {
    return 1;
  }
  const groupsByChoice = mapChoiceGroupsByChoice(choiceGroups);
  let roots = resolveRootChoiceGroups(choiceGroups);
  if (roots.length === 0) {
    roots = [...choiceGroups];
  }
  const visiting = /* @__PURE__ */ new Set();
  const memo = /* @__PURE__ */ new Map();
  const depthForGroup = (group) => {
    const key = choiceGroupKey(group.choiceValue);
    const cached = memo.get(key);
    if (cached !== void 0) {
      return cached;
    }
    if (visiting.has(key)) {
      return 1;
    }
    visiting.add(key);
    let maxChildDepth = 0;
    for (const family of group.families) {
      for (const action of family.results) {
        if (action.kind !== "choice-set" || action.choiceValue === void 0) {
          continue;
        }
        const childGroup = groupsByChoice.get(choiceGroupKey(action.choiceValue));
        if (!childGroup) {
          continue;
        }
        maxChildDepth = Math.max(maxChildDepth, depthForGroup(childGroup));
      }
    }
    visiting.delete(key);
    const depth = 1 + maxChildDepth;
    memo.set(key, depth);
    return depth;
  };
  return Math.max(...roots.map((group) => depthForGroup(group)), 1);
}
function collapseChoiceAnchors(anchors) {
  const grouped = /* @__PURE__ */ new Map();
  for (const anchor of anchors) {
    const existing = grouped.get(anchor.choiceValue) ?? [];
    existing.push(anchor);
    grouped.set(anchor.choiceValue, existing);
  }
  return [...grouped.entries()].sort((left, right) => left[0] - right[0]).map(([, valueAnchors]) => {
    const y = Math.round(
      valueAnchors.reduce((sum, anchor) => sum + anchor.y, 0) / valueAnchors.length
    );
    const x = Math.max(...valueAnchors.map((anchor) => anchor.x));
    return {
      choiceValue: valueAnchors[0]?.choiceValue ?? 0,
      nodeIds: uniqueValues(valueAnchors.map((anchor) => anchor.nodeId)),
      x,
      y
    };
  });
}
function compareChoiceGroups(left, right) {
  return compareNullableNumbers(left.choiceValue, right.choiceValue);
}
function choiceActionIdentity(action) {
  return `${action.choiceValue ?? ""}:${action.displayText}`;
}
function choiceGroupKey(choiceValue) {
  return choiceValue === null ? "root" : String(choiceValue);
}
function sourceGroupStepX() {
  return CHOICE_GAP_X - GATE_GAP_X + FOLLOWUP_GROUP_GAP_X;
}
function connectChoiceTransitions(context, records) {
  const orderedRecordsByTopic = /* @__PURE__ */ new Map();
  for (const [topic, topicRecords] of groupRecordsByTopic(records)) {
    orderedRecordsByTopic.set(topic, orderTopicRecordsByInfoSequence(topicRecords));
  }
  const connected = /* @__PURE__ */ new Set();
  for (const anchor of context.choiceTransitionAnchors) {
    const sourceRecords = anchor.sourceRecords.filter((record) => !record.suppressChoiceTransitions);
    if (sourceRecords.length === 0) {
      continue;
    }
    const targetRecords = resolveChoiceTransitionTargets(
      {
        ...anchor,
        sourceRecords
      },
      orderedRecordsByTopic
    );
    if (targetRecords.length === 0) {
      continue;
    }
    for (const targetRecord of targetRecords) {
      const entryNodeId = context.recordEntryNodeIds.get(targetRecord.id);
      if (!entryNodeId) {
        continue;
      }
      const connectionKey = `${anchor.nodeId}:${entryNodeId}:${anchor.choiceValue}`;
      if (connected.has(connectionKey)) {
        continue;
      }
      addEdge(context, connectionKey, anchor.nodeId, "right", entryNodeId, "left");
      connected.add(connectionKey);
    }
  }
}
function routeJournalRangeChoiceTransitions(context, records) {
  const recordByEntryNodeId = /* @__PURE__ */ new Map();
  for (const record of records) {
    const entryNodeId = context.recordEntryNodeIds.get(record.id);
    if (entryNodeId) {
      recordByEntryNodeId.set(entryNodeId, record);
    }
  }
  const sourcePhaseByChoiceNodeId = /* @__PURE__ */ new Map();
  for (const anchor of context.choiceTransitionAnchors) {
    const sourcePhases = anchor.sourceRecords.map((record) => record.sourcePhaseAnchor);
    if (sourcePhases.length === 0) {
      continue;
    }
    sourcePhaseByChoiceNodeId.set(anchor.nodeId, Math.min(...sourcePhases));
  }
  const incomingChoiceEdgesByTarget = /* @__PURE__ */ new Map();
  for (const edge of context.edges) {
    if (edge.fromSide !== "right" || edge.toSide !== "left") {
      continue;
    }
    const sourceNode = findCanvasNode(context, edge.fromNode);
    if (!sourceNode || !isChoiceNode(sourceNode)) {
      continue;
    }
    const targetRecord = recordByEntryNodeId.get(edge.toNode);
    if (!targetRecord || !hasJournalRangeCondition(targetRecord)) {
      continue;
    }
    const sourcePhase = sourcePhaseByChoiceNodeId.get(edge.fromNode);
    if (sourcePhase === void 0) {
      continue;
    }
    const targetEdges = incomingChoiceEdgesByTarget.get(edge.toNode) ?? [];
    targetEdges.push({ edge, sourcePhase });
    incomingChoiceEdgesByTarget.set(edge.toNode, targetEdges);
  }
  let jumpIndex = 1;
  for (const [targetNodeId, incomingEdges] of incomingChoiceEdgesByTarget) {
    if (incomingEdges.length <= 1) {
      continue;
    }
    const lowestPhase = Math.min(...incomingEdges.map((item) => item.sourcePhase));
    for (const item of incomingEdges.sort((left, right) => left.sourcePhase - right.sourcePhase || left.edge.id.localeCompare(right.edge.id))) {
      if (item.sourcePhase === lowestPhase) {
        continue;
      }
      const sourceNode = findCanvasNode(context, item.edge.fromNode);
      const targetNode = findCanvasNode(context, targetNodeId);
      if (!sourceNode || !targetNode) {
        continue;
      }
      const jumpText = `Jump #${jumpIndex}`;
      const jumpNodeId = addTextNode(
        context,
        `jump:${item.edge.fromNode}:${targetNodeId}:${jumpIndex}`,
        jumpText,
        Math.round((sourceNode.x + sourceNode.width + targetNode.x - JUMP_WIDTH) / 2),
        Math.round(edgeEndpoint(sourceNode, "right").y - measureTextHeight(jumpText, JUMP_WIDTH) / 2),
        JUMP_WIDTH,
        JUMP_COLOR
      );
      jumpIndex += 1;
      item.edge.toNode = jumpNodeId;
      item.edge.toSide = "left";
      addEdge(context, `${jumpNodeId}:${targetNodeId}`, jumpNodeId, "right", targetNodeId, "left");
    }
  }
}
function hasJournalRangeCondition(record) {
  const journalConditionsByQuest = groupJournalConditionsByQuest(record.conditions.filter(
    (condition) => condition.kind === "journal" && condition.questId !== void 0 && condition.value !== void 0
  ));
  for (const conditions of journalConditionsByQuest.values()) {
    const hasLowerBound = conditions.some((condition) => condition.operator === ">=" || condition.operator === ">");
    const hasUpperBound = conditions.some((condition) => condition.operator === "<=" || condition.operator === "<");
    if (hasLowerBound && hasUpperBound) {
      return true;
    }
  }
  return false;
}
function connectAddTopicTransitions(context, records) {
  const orderedRecordsByTopic = groupRecordsByNormalizedTopic(records);
  const transitions = [];
  for (const sourceRecord of records) {
    for (const action of sourceRecord.resultActions) {
      if (action.kind !== "add-topic" || !action.targetTopic) {
        continue;
      }
      const targetRecords = resolveAddTopicTransitionTargets(sourceRecord, action.targetTopic, orderedRecordsByTopic);
      if (targetRecords.length === 0) {
        continue;
      }
      const sourceNodeId = createNodeId(`dialogue:${sourceRecord.file.path}`);
      for (const targetRecord of targetRecords) {
        const targetNodeId = context.recordEntryNodeIds.get(targetRecord.id);
        if (!targetNodeId) {
          continue;
        }
        if (nodeCanReach(context, sourceNodeId, targetNodeId)) {
          continue;
        }
        transitions.push({
          sourceRecord,
          sourceNodeId,
          targetNodeId
        });
      }
    }
  }
  for (const transition of transitions) {
    addEdge(
      context,
      `${transition.sourceNodeId}:${transition.targetNodeId}:add-topic`,
      transition.sourceNodeId,
      "right",
      transition.targetNodeId,
      "left",
      "AddTopic"
    );
  }
}
function connectBodyTopicLinkTransitions(context, records) {
  const orderedRecordsByTopic = groupRecordsByNormalizedTopic(records);
  for (const sourceRecord of records) {
    if (!recordCanIntroduceBodyTopic(sourceRecord)) {
      continue;
    }
    const linkedTopics = extractBodyTopicLinks(sourceRecord.bodyText).filter(
      (topic) => normalizeTopicKey(topic) !== normalizeTopicKey(sourceRecord.topic)
    );
    if (linkedTopics.length === 0) {
      continue;
    }
    const sourceNodeId = createNodeId(`dialogue:${sourceRecord.file.path}`);
    for (const targetTopic of linkedTopics) {
      const targetRecords = resolveAddTopicTransitionTargets(sourceRecord, targetTopic, orderedRecordsByTopic);
      for (const targetRecord of targetRecords) {
        if (targetRecord.id === sourceRecord.id) {
          continue;
        }
        const targetNodeId = context.recordEntryNodeIds.get(targetRecord.id);
        if (!targetNodeId || nodeCanReach(context, sourceNodeId, targetNodeId)) {
          continue;
        }
        addEdge(
          context,
          `${sourceNodeId}:${targetNodeId}:body-topic:${normalizeTopicKey(targetTopic)}`,
          sourceNodeId,
          "right",
          targetNodeId,
          "left"
        );
      }
    }
  }
}
function recordCanIntroduceBodyTopic(record) {
  return !record.conditions.some((condition) => condition.kind === "choice") && record.conditions.some((condition) => condition.kind === "journal" && condition.value === 0 && (condition.operator === "=" || condition.operator === "=="));
}
function connectAdjacentJournalPhaseTerminalTransitions(context, records, phaseIndices, questIds) {
  const orderedPhases = uniqueNumbers(phaseIndices.filter((phaseValue) => phaseValue > 0));
  for (let index = 1; index < orderedPhases.length; index += 1) {
    const sourcePhase = orderedPhases[index - 1];
    const targetPhase = orderedPhases[index];
    if (sourcePhase === void 0 || targetPhase === void 0) {
      continue;
    }
    if (phaseHasExplicitJournalProgression(records, sourcePhase, targetPhase, questIds)) {
      continue;
    }
    const sourceRecords = records.filter(
      (record) => recordHasExactJournalCondition(record, sourcePhase, questIds) && isTerminalCanvasRecord(context, record)
    );
    const targetRecords = records.filter(
      (record) => recordHasExactJournalCondition(record, targetPhase, questIds) && !record.conditions.some((condition) => condition.kind === "choice")
    );
    for (const sourceRecord of sourceRecords) {
      const sourceNodeId = createNodeId(`dialogue:${sourceRecord.file.path}`);
      for (const targetRecord of targetRecords) {
        if (!recordsShareExactJournalQuest(sourceRecord, sourcePhase, targetRecord, targetPhase, questIds)) {
          continue;
        }
        if (!conditionsCanFollowJournalPhase(sourceRecord, targetRecord, targetPhase)) {
          continue;
        }
        const targetNodeId = context.recordEntryNodeIds.get(targetRecord.id);
        const entryNodeId = targetNodeId ? rootEntryNodeForExistingBranch(context, targetNodeId) : void 0;
        if (!entryNodeId || nodeCanReach(context, sourceNodeId, entryNodeId)) {
          continue;
        }
        addEdge(
          context,
          `${sourceNodeId}:${entryNodeId}:journal-phase:${sourcePhase}:${targetPhase}`,
          sourceNodeId,
          "right",
          entryNodeId,
          "left"
        );
      }
    }
  }
}
function rootEntryNodeForExistingBranch(context, targetNodeId) {
  const incomingByNode = /* @__PURE__ */ new Map();
  for (const edge of context.edges) {
    if (edge.fromSide === "bottom" && edge.toSide === "top") {
      continue;
    }
    const incomingEdges = incomingByNode.get(edge.toNode) ?? [];
    incomingEdges.push(edge);
    incomingByNode.set(edge.toNode, incomingEdges);
  }
  const ancestors = /* @__PURE__ */ new Set();
  const queue = [targetNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || ancestors.has(nodeId)) {
      continue;
    }
    ancestors.add(nodeId);
    for (const edge of incomingByNode.get(nodeId) ?? []) {
      if (!ancestors.has(edge.fromNode)) {
        queue.push(edge.fromNode);
      }
    }
  }
  const roots = [...ancestors].filter((nodeId) => (incomingByNode.get(nodeId) ?? []).length === 0);
  if (roots.length === 0) {
    return targetNodeId;
  }
  return roots.sort((left, right) => compareCanvasNodePosition(context, left, right))[0] ?? targetNodeId;
}
function compareCanvasNodePosition(context, leftNodeId, rightNodeId) {
  const leftNode = findCanvasNode(context, leftNodeId);
  const rightNode = findCanvasNode(context, rightNodeId);
  if (!leftNode || !rightNode) {
    return leftNodeId.localeCompare(rightNodeId);
  }
  return leftNode.x - rightNode.x || leftNode.y - rightNode.y || leftNodeId.localeCompare(rightNodeId);
}
function phaseHasExplicitJournalProgression(records, sourcePhase, targetPhase, questIds) {
  return records.some((record) => recordHasExactJournalCondition(record, sourcePhase, questIds) && record.resultActions.some((action) => action.kind === "journal-set" && action.targetQuestId !== void 0 && questIds.includes(action.targetQuestId) && action.targetJournalIndex === targetPhase));
}
function resolveAddTopicTransitionTargets(sourceRecord, targetTopic, orderedRecordsByTopic) {
  const targetRecords = orderedRecordsByTopic.get(normalizeTopicKey(targetTopic)) ?? [];
  const candidates = targetRecords.filter((candidate) => conditionsCanFollowAddTopic(sourceRecord, candidate));
  if (candidates.length <= 1) {
    return candidates;
  }
  const scoredCandidates = candidates.map((candidate) => ({
    candidate,
    score: scoreAddTopicTransitionTarget(sourceRecord, candidate)
  }));
  const bestScore = Math.max(...scoredCandidates.map((item) => item.score));
  const bestCandidates = scoredCandidates.filter((item) => item.score === bestScore).map((item) => item.candidate);
  return bestScore > 0 ? bestCandidates : [candidates[0]];
}
function extractBodyTopicLinks(bodyText) {
  const topics = [];
  const seen = /* @__PURE__ */ new Set();
  const linkPattern = /\[\[([^\]]+)\]\]/g;
  let match = linkPattern.exec(bodyText);
  while (match) {
    const topic = normalizeWikilinkTopic(match[1] ?? "");
    const topicKey = normalizeTopicKey(topic);
    if (topic.length > 0 && !seen.has(topicKey)) {
      topics.push(topic);
      seen.add(topicKey);
    }
    match = linkPattern.exec(bodyText);
  }
  return topics;
}
function normalizeWikilinkTopic(rawLink) {
  const linkTarget = (rawLink.split("|")[0] ?? rawLink).split("#")[0]?.trim() ?? "";
  const pathParts = linkTarget.split("/");
  const fileName = pathParts[pathParts.length - 1] ?? linkTarget;
  return fileName.replace(/\.md$/i, "").trim();
}
function isTerminalCanvasRecord(context, record) {
  if (record.resultActions.some((action) => action.kind === "journal-set" || action.kind === "choice-set" || action.kind === "add-topic")) {
    return false;
  }
  const sourceNodeId = createNodeId(`dialogue:${record.file.path}`);
  return !context.edges.some(
    (edge) => edge.fromNode === sourceNodeId && !(edge.fromSide === "bottom" && edge.toSide === "top")
  );
}
function recordHasExactJournalCondition(record, phaseValue, questIds) {
  return exactJournalConditionQuestIds(record, phaseValue, questIds).length > 0;
}
function recordsShareExactJournalQuest(sourceRecord, sourcePhase, targetRecord, targetPhase, questIds) {
  const sourceQuestIds = new Set(exactJournalConditionQuestIds(sourceRecord, sourcePhase, questIds));
  return exactJournalConditionQuestIds(targetRecord, targetPhase, questIds).some((questId) => sourceQuestIds.has(questId));
}
function exactJournalConditionQuestIds(record, phaseValue, questIds) {
  return record.conditions.filter((condition) => condition.kind === "journal" && condition.questId !== void 0 && questIds.includes(condition.questId) && condition.value === phaseValue && (condition.operator === "=" || condition.operator === "==")).map((condition) => condition.questId);
}
function conditionsCanFollowJournalPhase(sourceRecord, candidate, targetPhase) {
  if (!speakerConditionsAreCompatible(sourceRecord.speakerConditions, candidate.speakerConditions)) {
    return false;
  }
  if (!numericConditionsAreCompatible(sourceRecord.conditions, candidate.conditions, ["item", "variable"])) {
    return false;
  }
  for (const condition of candidate.conditions) {
    if (condition.kind === "journal" && condition.questId !== void 0 && condition.value !== void 0 && !journalConditionMatches(targetPhase, condition)) {
      return false;
    }
  }
  return true;
}
function journalConditionsAreCompatible(sourceConditions, candidateConditions) {
  return numericConditionsAreCompatible(sourceConditions, candidateConditions, ["journal"]);
}
function findCanvasNode(context, nodeId) {
  return context.nodes.find((node) => node.id === nodeId);
}
function assignDialogueInfoOrder(records) {
  for (const topicRecords of groupRecordsByTopic(records).values()) {
    const orderedRecords = orderTopicRecordsByInfoSequence(topicRecords);
    for (let index = 0; index < orderedRecords.length; index += 1) {
      const record = orderedRecords[index];
      if (!record) {
        continue;
      }
      record.infoOrder = index;
    }
  }
  return records;
}
function resolveChoiceDerivedPhaseAnchors(records) {
  const orderedRecordsByTopic = /* @__PURE__ */ new Map();
  for (const [topic, topicRecords] of groupRecordsByTopic(records)) {
    orderedRecordsByTopic.set(topic, orderTopicRecordsByInfoSequence(topicRecords));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      for (const choiceValue of record.choiceTargets) {
        const targetRecords = resolveChoiceTransitionTargets(
          {
            topic: record.topic,
            choiceValue,
            nodeId: "",
            sourceRecords: [record]
          },
          orderedRecordsByTopic
        );
        for (const targetRecord of targetRecords) {
          if (targetRecord.phaseAnchor >= record.phaseAnchor) {
            continue;
          }
          record.phaseAnchor = targetRecord.phaseAnchor;
          changed = true;
        }
      }
    }
  }
  return records;
}
function stripUnrelatedAddTopicChoices(records) {
  return records.map((record) => {
    if (record.directlyRelevant || !record.resultActions.some((action) => action.kind === "add-topic") || !record.resultActions.some((action) => action.kind === "choice-set")) {
      return record;
    }
    return {
      ...record,
      suppressChoiceTransitions: true
    };
  });
}
function resolveChoiceTransitionTargets(anchor, orderedRecordsByTopic) {
  const topicRecords = orderedRecordsByTopic.get(anchor.topic) ?? [];
  const targetRecords = [];
  for (const candidate of topicRecords) {
    if (!candidate.choiceValues.includes(anchor.choiceValue)) {
      continue;
    }
    if (anchor.sourceRecords.some((sourceRecord) => candidate.id !== sourceRecord.id && conditionsCanFollowChoice(sourceRecord, candidate, anchor.choiceValue))) {
      const score = Math.max(
        ...anchor.sourceRecords.map((sourceRecord) => scoreChoiceTransitionTarget(sourceRecord, candidate))
      );
      targetRecords.push({ record: candidate, score });
    }
  }
  if (targetRecords.length <= 1) {
    return targetRecords.map((target) => target.record);
  }
  const bestScore = Math.max(...targetRecords.map((target) => target.score));
  if (bestScore <= 0) {
    return targetRecords.map((target) => target.record);
  }
  return targetRecords.filter((target) => target.score === bestScore).map((target) => target.record);
}
function orderTopicRecordsByInfoSequence(records) {
  const recordsByDiagId = /* @__PURE__ */ new Map();
  const nextRecordsByPrevId = /* @__PURE__ */ new Map();
  for (const record of records) {
    if (record.diagId.length > 0) {
      recordsByDiagId.set(record.diagId, record);
    }
    if (record.prevId.length > 0) {
      const nextRecords = nextRecordsByPrevId.get(record.prevId) ?? [];
      nextRecords.push(record);
      nextRecordsByPrevId.set(record.prevId, nextRecords);
    }
  }
  const orderedRecords = [];
  const visitedRecordIds = /* @__PURE__ */ new Set();
  const visitRecord = (record) => {
    if (visitedRecordIds.has(record.id)) {
      return;
    }
    orderedRecords.push(record);
    visitedRecordIds.add(record.id);
    for (const nextRecord of [...nextRecordsByPrevId.get(record.diagId) ?? []].sort(compareDialogueRecords)) {
      visitRecord(nextRecord);
    }
  };
  for (const record of [...records].sort(compareDialogueRecords)) {
    if (record.prevId.length > 0 && recordsByDiagId.has(record.prevId)) {
      continue;
    }
    visitRecord(record);
  }
  for (const record of [...records].sort(compareDialogueRecords)) {
    visitRecord(record);
  }
  return orderedRecords;
}
function conditionsCanFollowChoice(sourceRecord, candidate, choiceValue) {
  const candidateChoiceConditions = candidate.conditions.filter((condition) => condition.kind === "choice");
  if (candidateChoiceConditions.length > 0 && candidateChoiceConditions.some((condition) => condition.choiceValue !== choiceValue)) {
    return false;
  }
  if (!speakerConditionsAreCompatible(sourceRecord.speakerConditions, candidate.speakerConditions)) {
    return false;
  }
  if (!numericConditionsAreCompatible(sourceRecord.conditions, candidate.conditions, ["item", "variable"])) {
    return false;
  }
  const knownJournalValues = collectKnownJournalValuesAfterResult(sourceRecord);
  for (const condition of candidate.conditions) {
    if (condition.kind !== "journal" || condition.questId === void 0 || condition.value === void 0) {
      continue;
    }
    const knownValue = knownJournalValues.get(condition.questId);
    if (knownValue !== void 0 && !journalConditionMatches(knownValue, condition)) {
      return false;
    }
  }
  const knownItemValues = collectKnownItemValues(sourceRecord.conditions);
  for (const condition of candidate.conditions) {
    if (condition.kind !== "item" || condition.questId === void 0 || condition.value === void 0) {
      continue;
    }
    const knownValue = knownItemValues.get(condition.questId);
    if (knownValue !== void 0 && !numericConditionMatches(knownValue, condition)) {
      return false;
    }
  }
  return true;
}
function conditionsCanFollowAddTopic(sourceRecord, candidate) {
  if (candidate.type !== "Topic" || candidate.conditions.some((condition) => condition.kind === "choice")) {
    return false;
  }
  if (!speakerConditionsAreCompatible(sourceRecord.speakerConditions, candidate.speakerConditions)) {
    return false;
  }
  if (!numericConditionsAreCompatible(sourceRecord.conditions, candidate.conditions, ["item", "variable"])) {
    return false;
  }
  if (!journalConditionsAreCompatible(sourceRecord.conditions, candidate.conditions)) {
    return false;
  }
  const knownJournalValues = collectKnownJournalValuesAfterResult(sourceRecord);
  for (const condition of candidate.conditions) {
    if (condition.kind !== "journal" || condition.questId === void 0 || condition.value === void 0) {
      continue;
    }
    const knownValue = knownJournalValues.get(condition.questId);
    if (knownValue !== void 0 && !journalConditionMatches(knownValue, condition)) {
      return false;
    }
  }
  const knownItemValues = collectKnownItemValues(sourceRecord.conditions);
  for (const condition of candidate.conditions) {
    if (condition.kind !== "item" || condition.questId === void 0 || condition.value === void 0) {
      continue;
    }
    const knownValue = knownItemValues.get(condition.questId);
    if (knownValue !== void 0 && !numericConditionMatches(knownValue, condition)) {
      return false;
    }
  }
  return true;
}
function scoreAddTopicTransitionTarget(sourceRecord, candidate) {
  const knownJournalValues = collectKnownJournalValuesAfterResult(sourceRecord);
  const knownItemValues = collectKnownItemValues(sourceRecord.conditions);
  let score = countMatchingSpeakerConditions(sourceRecord.speakerConditions, candidate.speakerConditions);
  for (const condition of candidate.conditions) {
    if (condition.kind === "journal" && condition.questId !== void 0 && condition.value !== void 0) {
      const knownValue = knownJournalValues.get(condition.questId);
      if (knownValue !== void 0 && journalConditionMatches(knownValue, condition)) {
        score += 1;
      }
    }
    if (condition.kind === "item" && condition.questId !== void 0 && condition.value !== void 0) {
      const knownValue = knownItemValues.get(condition.questId);
      if (knownValue !== void 0 && numericConditionMatches(knownValue, condition)) {
        score += 1;
      }
    }
  }
  return score;
}
function scoreChoiceTransitionTarget(sourceRecord, candidate) {
  const knownJournalValues = collectKnownJournalValuesAfterResult(sourceRecord);
  const knownItemValues = collectKnownItemValues(sourceRecord.conditions);
  let score = countMatchingSpeakerConditions(sourceRecord.speakerConditions, candidate.speakerConditions);
  for (const condition of candidate.conditions) {
    if (condition.kind === "journal" && condition.questId !== void 0 && condition.value !== void 0) {
      const knownValue = knownJournalValues.get(condition.questId);
      if (knownValue !== void 0 && journalConditionMatches(knownValue, condition)) {
        score += 1;
      }
    }
    if (condition.kind === "item" && condition.questId !== void 0 && condition.value !== void 0) {
      const knownValue = knownItemValues.get(condition.questId);
      if (knownValue !== void 0 && numericConditionMatches(knownValue, condition)) {
        score += 1;
      }
    }
  }
  return score;
}
function speakerConditionsAreCompatible(sourceConditions, candidateConditions) {
  const sourceValuesByLabel = /* @__PURE__ */ new Map();
  for (const condition of sourceConditions) {
    const parsed = parseSpeakerConditionDisplayText(condition.displayText);
    if (!parsed) {
      continue;
    }
    sourceValuesByLabel.set(parsed.label, parsed.value.toLowerCase());
  }
  for (const condition of candidateConditions) {
    const parsed = parseSpeakerConditionDisplayText(condition.displayText);
    if (!parsed) {
      continue;
    }
    const sourceValue = sourceValuesByLabel.get(parsed.label);
    if (sourceValue !== void 0 && sourceValue !== parsed.value.toLowerCase()) {
      return false;
    }
  }
  return true;
}
function countMatchingSpeakerConditions(sourceConditions, candidateConditions) {
  const sourceValuesByLabel = /* @__PURE__ */ new Map();
  for (const condition of sourceConditions) {
    const parsed = parseSpeakerConditionDisplayText(condition.displayText);
    if (!parsed) {
      continue;
    }
    sourceValuesByLabel.set(parsed.label, parsed.value.toLowerCase());
  }
  let count = 0;
  for (const condition of candidateConditions) {
    const parsed = parseSpeakerConditionDisplayText(condition.displayText);
    if (!parsed) {
      continue;
    }
    const sourceValue = sourceValuesByLabel.get(parsed.label);
    if (sourceValue !== void 0 && sourceValue === parsed.value.toLowerCase()) {
      count += 1;
    }
  }
  return count;
}
function parseSpeakerConditionDisplayText(displayText) {
  const separator = displayText.indexOf(" = ");
  if (separator === -1) {
    return null;
  }
  return {
    label: displayText.slice(0, separator),
    value: displayText.slice(separator + 3)
  };
}
function numericConditionsAreCompatible(sourceConditions, candidateConditions, kinds) {
  for (const sourceCondition of sourceConditions) {
    if (!isStructuredNumericCondition(sourceCondition, kinds)) {
      continue;
    }
    for (const candidateCondition of candidateConditions) {
      if (!isStructuredNumericCondition(candidateCondition, kinds)) {
        continue;
      }
      if (sourceCondition.kind !== candidateCondition.kind || sourceCondition.questId !== candidateCondition.questId) {
        continue;
      }
      if (!numericConditionRangesOverlap(sourceCondition, candidateCondition)) {
        return false;
      }
    }
  }
  return true;
}
function isStructuredNumericCondition(condition, kinds) {
  return kinds.includes(condition.kind) && condition.questId !== void 0 && condition.value !== void 0 && condition.operator !== void 0;
}
function numericConditionRangesOverlap(left, right) {
  const leftRange = numericConditionRange(left);
  const rightRange = numericConditionRange(right);
  const min = Math.max(leftRange.min, rightRange.min);
  const max = Math.min(leftRange.max, rightRange.max);
  const minInclusive = numericRangeUsesInclusiveMin(leftRange, min) && numericRangeUsesInclusiveMin(rightRange, min);
  const maxInclusive = numericRangeUsesInclusiveMax(leftRange, max) && numericRangeUsesInclusiveMax(rightRange, max);
  if (min > max) {
    return false;
  }
  if (min === max) {
    if (!minInclusive || !maxInclusive) {
      return false;
    }
    return !leftRange.excludedValues.includes(min) && !rightRange.excludedValues.includes(min);
  }
  return true;
}
function numericConditionRange(condition) {
  const value = condition.value ?? 0;
  switch (condition.operator) {
    case "<=":
      return {
        min: Number.NEGATIVE_INFINITY,
        minInclusive: false,
        max: value,
        maxInclusive: true,
        excludedValues: []
      };
    case ">=":
      return {
        min: value,
        minInclusive: true,
        max: Number.POSITIVE_INFINITY,
        maxInclusive: false,
        excludedValues: []
      };
    case "<":
      return {
        min: Number.NEGATIVE_INFINITY,
        minInclusive: false,
        max: value,
        maxInclusive: false,
        excludedValues: []
      };
    case ">":
      return {
        min: value,
        minInclusive: false,
        max: Number.POSITIVE_INFINITY,
        maxInclusive: false,
        excludedValues: []
      };
    case "!=":
      return {
        min: Number.NEGATIVE_INFINITY,
        minInclusive: false,
        max: Number.POSITIVE_INFINITY,
        maxInclusive: false,
        excludedValues: [value]
      };
    case "==":
    case "=":
    default:
      return {
        min: value,
        minInclusive: true,
        max: value,
        maxInclusive: true,
        excludedValues: []
      };
  }
}
function numericRangeUsesInclusiveMin(range, min) {
  if (range.min === Number.NEGATIVE_INFINITY || range.min < min) {
    return true;
  }
  return range.minInclusive;
}
function numericRangeUsesInclusiveMax(range, max) {
  if (range.max === Number.POSITIVE_INFINITY || range.max > max) {
    return true;
  }
  return range.maxInclusive;
}
function collectKnownJournalValuesAfterResult(record) {
  const knownValues = /* @__PURE__ */ new Map();
  for (const condition of record.conditions) {
    if (condition.kind === "journal" && condition.questId !== void 0 && condition.value !== void 0 && condition.operator === "=") {
      knownValues.set(condition.questId, condition.value);
    }
  }
  for (const action of record.resultActions) {
    if (action.kind === "journal-set" && action.targetQuestId !== void 0 && action.targetJournalIndex !== void 0) {
      knownValues.set(action.targetQuestId, action.targetJournalIndex);
    }
  }
  return knownValues;
}
function collectKnownItemValues(conditions) {
  const knownValues = /* @__PURE__ */ new Map();
  for (const condition of conditions) {
    if (condition.kind !== "item" || condition.questId === void 0 || condition.value === void 0 || condition.operator !== "=") {
      continue;
    }
    knownValues.set(condition.questId, condition.value);
  }
  return knownValues;
}
function journalConditionMatches(value, condition) {
  if (condition.value === void 0) {
    return true;
  }
  return numericConditionMatches(value, condition);
}
function numericConditionMatches(value, condition) {
  if (condition.value === void 0) {
    return true;
  }
  switch (condition.operator) {
    case "<=":
      return value <= condition.value;
    case ">=":
      return value >= condition.value;
    case "<":
      return value < condition.value;
    case ">":
      return value > condition.value;
    case "!=":
      return value !== condition.value;
    case "==":
      return value === condition.value;
    case "=":
    default:
      return value === condition.value;
  }
}
function connectScriptedMilestones(context, phaseIndices) {
  for (let index = 1; index < phaseIndices.length; index += 1) {
    const previousPhase = phaseIndices[index - 1];
    const currentPhase = phaseIndices[index];
    if (previousPhase === void 0 || currentPhase === void 0) {
      continue;
    }
    const incoming = context.phaseIncomingCounts.get(currentPhase) ?? 0;
    const outgoing = context.phaseOutgoingCounts.get(previousPhase) ?? 0;
    if (incoming > 0 || outgoing > 0) {
      continue;
    }
    const fromNode = context.phaseNodeIds.get(previousPhase);
    const toNode = context.phaseNodeIds.get(currentPhase);
    if (!fromNode || !toNode) {
      continue;
    }
    addEdge(context, `${fromNode}:${toNode}:scripted`, fromNode, "right", toNode, "left");
  }
}
function edgeEndpoint(node, side) {
  switch (side) {
    case "left":
      return { x: node.x, y: node.y + node.height / 2 };
    case "right":
      return { x: node.x + node.width, y: node.y + node.height / 2 };
    case "top":
      return { x: node.x + node.width / 2, y: node.y };
    case "bottom":
      return { x: node.x + node.width / 2, y: node.y + node.height };
  }
}
function isChoiceNode(node) {
  return node.type === "text" && /^".*"\s+-\s+Choice\s+-?\d+/.test(node.text ?? "");
}
function isGateNode(node) {
  return node.type === "text" && !isChoiceNode(node);
}
function isDialogueFileNode(node) {
  return node.type === "file" && !node.file?.includes(`/${JOURNAL_FOLDER_NAME}/`);
}
function applyLayeredCanvasLayout(context) {
  const units = buildLayoutUnits(context);
  if (units.length === 0) {
    return;
  }
  const unitById = /* @__PURE__ */ new Map();
  const unitIdByNodeId = /* @__PURE__ */ new Map();
  for (const unit of units) {
    unitById.set(unit.id, unit);
    unitIdByNodeId.set(unit.root.id, unit.id);
    for (const attachment of unit.attachments) {
      unitIdByNodeId.set(attachment.id, unit.id);
    }
  }
  linkAcyclicUnitGraph(context, units, unitById, unitIdByNodeId);
  assignUnitLayers(units, unitById);
  assignUnitComponentOrder(units, unitById);
  const layerXPositions = computeLayerXPositions(context, units, unitById, unitIdByNodeId);
  insertSpacerUnits(units, unitById, layerXPositions);
  assignUnitTops(units, unitById);
  applyUnitPositions(units, layerXPositions);
  nudgeUnitsOffEdges(context, units, unitIdByNodeId, layerXPositions);
}
function applyUnitPositions(units, layerXPositions) {
  for (const unit of units) {
    if (unit.virtual) {
      continue;
    }
    const unitX = layerXPositions.get(unit.layer) ?? 0;
    unit.root.x = unitX;
    unit.root.y = Math.round(unit.top);
    let cursorY = unit.root.y + unit.root.height;
    for (const attachment of unit.attachments) {
      attachment.x = unitX;
      attachment.y = cursorY + RESULT_GAP_Y;
      cursorY = attachment.y + attachment.height;
    }
  }
}
function buildLayoutUnits(context) {
  const nodeById = new Map(context.nodes.map((node) => [node.id, node]));
  const attachmentChildIds = /* @__PURE__ */ new Map();
  const attachedIds = /* @__PURE__ */ new Set();
  for (const edge of context.edges) {
    if (edge.fromSide !== "bottom" || edge.toSide !== "top") {
      continue;
    }
    if (!nodeById.has(edge.fromNode) || !nodeById.has(edge.toNode)) {
      continue;
    }
    if (attachedIds.has(edge.toNode) || edge.fromNode === edge.toNode) {
      continue;
    }
    const childIds = attachmentChildIds.get(edge.fromNode) ?? [];
    childIds.push(edge.toNode);
    attachmentChildIds.set(edge.fromNode, childIds);
    attachedIds.add(edge.toNode);
  }
  const units = [];
  for (let nodeIndex = 0; nodeIndex < context.nodes.length; nodeIndex += 1) {
    const node = context.nodes[nodeIndex];
    if (!node || attachedIds.has(node.id)) {
      continue;
    }
    const attachments = [];
    const queue = [...attachmentChildIds.get(node.id) ?? []];
    while (queue.length > 0) {
      const attachmentId = queue.shift();
      const attachment = attachmentId ? nodeById.get(attachmentId) : void 0;
      if (!attachment) {
        continue;
      }
      attachments.push(attachment);
      queue.push(...attachmentChildIds.get(attachment.id) ?? []);
    }
    let width = node.width;
    let height = node.height;
    for (const attachment of attachments) {
      width = Math.max(width, attachment.width);
      height += RESULT_GAP_Y + attachment.height;
    }
    units.push({
      id: node.id,
      root: node,
      attachments,
      width,
      height,
      layer: 0,
      componentOrder: nodeIndex,
      creationIndex: nodeIndex,
      top: 0,
      predIds: /* @__PURE__ */ new Set(),
      succIds: /* @__PURE__ */ new Set()
    });
  }
  return units;
}
function linkAcyclicUnitGraph(context, units, unitById, unitIdByNodeId) {
  const rawSuccIds = /* @__PURE__ */ new Map();
  const seenUnitEdges = /* @__PURE__ */ new Set();
  for (const edge of context.edges) {
    if (edge.fromSide === "bottom" && edge.toSide === "top") {
      continue;
    }
    const fromUnitId = unitIdByNodeId.get(edge.fromNode);
    const toUnitId = unitIdByNodeId.get(edge.toNode);
    if (!fromUnitId || !toUnitId || fromUnitId === toUnitId) {
      continue;
    }
    const unitEdgeKey = `${fromUnitId}:${toUnitId}`;
    if (seenUnitEdges.has(unitEdgeKey)) {
      continue;
    }
    seenUnitEdges.add(unitEdgeKey);
    const succIds = rawSuccIds.get(fromUnitId) ?? [];
    succIds.push(toUnitId);
    rawSuccIds.set(fromUnitId, succIds);
  }
  const visitState = /* @__PURE__ */ new Map();
  const visit = (unitId) => {
    visitState.set(unitId, "visiting");
    for (const succId of rawSuccIds.get(unitId) ?? []) {
      const state = visitState.get(succId);
      if (state === "visiting") {
        continue;
      }
      const fromUnit = unitById.get(unitId);
      const toUnit = unitById.get(succId);
      if (fromUnit && toUnit) {
        fromUnit.succIds.add(succId);
        toUnit.predIds.add(unitId);
      }
      if (state === void 0) {
        visit(succId);
      }
    }
    visitState.set(unitId, "done");
  };
  for (const unit of units) {
    if (!visitState.has(unit.id)) {
      visit(unit.id);
    }
  }
}
function assignUnitLayers(units, unitById) {
  const remainingIncoming = /* @__PURE__ */ new Map();
  const ready = [];
  for (const unit of units) {
    unit.layer = 0;
    remainingIncoming.set(unit.id, unit.predIds.size);
    if (unit.predIds.size === 0) {
      ready.push(unit);
    }
  }
  while (ready.length > 0) {
    const unit = ready.shift();
    if (!unit) {
      break;
    }
    for (const succId of unit.succIds) {
      const succ = unitById.get(succId);
      if (!succ) {
        continue;
      }
      succ.layer = Math.max(succ.layer, unit.layer + 1);
      const remaining = (remainingIncoming.get(succId) ?? 0) - 1;
      remainingIncoming.set(succId, remaining);
      if (remaining === 0) {
        ready.push(succ);
      }
    }
  }
  for (const unit of units) {
    if (unit.predIds.size > 0 || unit.succIds.size === 0) {
      continue;
    }
    let minSuccLayer = Number.POSITIVE_INFINITY;
    for (const succId of unit.succIds) {
      minSuccLayer = Math.min(minSuccLayer, unitById.get(succId)?.layer ?? Number.POSITIVE_INFINITY);
    }
    if (Number.isFinite(minSuccLayer)) {
      unit.layer = Math.max(unit.layer, minSuccLayer - 1);
    }
  }
}
function assignUnitComponentOrder(units, unitById) {
  const componentRoots = /* @__PURE__ */ new Map();
  const findRoot = (unitId) => {
    const parent = componentRoots.get(unitId);
    if (!parent || parent === unitId) {
      componentRoots.set(unitId, unitId);
      return unitId;
    }
    const root = findRoot(parent);
    componentRoots.set(unitId, root);
    return root;
  };
  const union = (leftId, rightId) => {
    const leftRoot = findRoot(leftId);
    const rightRoot = findRoot(rightId);
    if (leftRoot !== rightRoot) {
      componentRoots.set(rightRoot, leftRoot);
    }
  };
  for (const unit of units) {
    findRoot(unit.id);
  }
  for (const unit of units) {
    for (const succId of unit.succIds) {
      union(unit.id, succId);
    }
  }
  const componentOrderByRoot = /* @__PURE__ */ new Map();
  for (const unit of units) {
    const root = findRoot(unit.id);
    const existing = componentOrderByRoot.get(root);
    if (existing === void 0 || unit.creationIndex < existing) {
      componentOrderByRoot.set(root, unit.creationIndex);
    }
  }
  for (const unit of units) {
    unit.componentOrder = componentOrderByRoot.get(findRoot(unit.id)) ?? unit.creationIndex;
  }
  void unitById;
}
function nudgeUnitsOffEdges(context, units, unitIdByNodeId, layerXPositions) {
  const nodeById = new Map(context.nodes.map((node) => [node.id, node]));
  const realUnits = units.filter((unit) => !unit.virtual);
  const unitsByLayer = /* @__PURE__ */ new Map();
  for (const unit of realUnits) {
    const layerUnits = unitsByLayer.get(unit.layer) ?? [];
    layerUnits.push(unit);
    unitsByLayer.set(unit.layer, layerUnits);
  }
  const margin = 24;
  const maxPasses = 6;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const segments = [];
    for (const edge of context.edges) {
      if (edge.fromSide === "bottom" && edge.toSide === "top") {
        continue;
      }
      const fromNode = nodeById.get(edge.fromNode);
      const toNode = nodeById.get(edge.toNode);
      if (!fromNode || !toNode) {
        continue;
      }
      segments.push({
        p1: edgeEndpoint(fromNode, edge.fromSide),
        p2: edgeEndpoint(toNode, edge.toSide),
        fromUnitId: unitIdByNodeId.get(edge.fromNode),
        toUnitId: unitIdByNodeId.get(edge.toNode)
      });
    }
    let moved = false;
    for (const layerUnits of unitsByLayer.values()) {
      for (const unit of layerUnits) {
        const left = unit.root.x;
        const right = unit.root.x + unit.width;
        const top = unit.top;
        const bottom = unit.top + unit.height;
        let delta = 0;
        for (const segment of segments) {
          if (segment.fromUnitId === unit.id || segment.toUnitId === unit.id) {
            continue;
          }
          const clip = segmentYRangeOverSpan(segment.p1, segment.p2, left, right);
          if (!clip || clip.maxY < top - margin / 2 || clip.minY > bottom + margin / 2) {
            continue;
          }
          const moveDownBy = clip.maxY + margin - top;
          const moveUpBy = bottom + margin - clip.minY;
          const candidate = moveDownBy <= moveUpBy ? moveDownBy : -moveUpBy;
          if (Math.abs(candidate) > Math.abs(delta)) {
            delta = candidate;
          }
        }
        if (delta !== 0) {
          unit.top += delta;
          moved = true;
        }
      }
    }
    if (!moved) {
      return;
    }
    for (const layerUnits of unitsByLayer.values()) {
      layerUnits.sort((leftUnit, rightUnit) => leftUnit.top - rightUnit.top);
      let previous = null;
      for (const unit of layerUnits) {
        if (previous) {
          const minimumTop = previous.top + previous.height + verticalUnitGap(previous, unit);
          unit.top = Math.max(unit.top, minimumTop);
        }
        previous = unit;
      }
    }
    applyUnitPositions(units, layerXPositions);
  }
}
function segmentYRangeOverSpan(p1, p2, left, right) {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const clippedLeft = Math.max(minX, left);
  const clippedRight = Math.min(maxX, right);
  if (clippedLeft >= clippedRight) {
    return null;
  }
  const yAt = (x) => {
    if (p1.x === p2.x) {
      return Math.min(p1.y, p2.y);
    }
    return p1.y + (p2.y - p1.y) * (x - p1.x) / (p2.x - p1.x);
  };
  const yLeft = yAt(clippedLeft);
  const yRight = yAt(clippedRight);
  return {
    minY: Math.min(yLeft, yRight),
    maxY: Math.max(yLeft, yRight)
  };
}
function insertSpacerUnits(units, unitById, layerXPositions) {
  const layerWidths = /* @__PURE__ */ new Map();
  for (const unit of units) {
    layerWidths.set(unit.layer, Math.max(layerWidths.get(unit.layer) ?? 0, unit.width));
  }
  for (const unit of [...units]) {
    for (const succId of [...unit.succIds]) {
      const succ = unitById.get(succId);
      if (!succ || succ.layer - unit.layer < 2) {
        continue;
      }
      const sourceAnchorX = (layerXPositions.get(unit.layer) ?? 0) + unit.root.width;
      const targetAnchorX = layerXPositions.get(succ.layer) ?? sourceAnchorX + 1;
      const anchorSpanX = Math.max(1, targetAnchorX - sourceAnchorX);
      unit.succIds.delete(succId);
      succ.predIds.delete(unit.id);
      let previous = unit;
      for (let layer = unit.layer + 1; layer < succ.layer; layer += 1) {
        const spacerX = (layerXPositions.get(layer) ?? 0) + (layerWidths.get(layer) ?? 0) / 2;
        const chainT = Math.min(1, Math.max(0, (spacerX - sourceAnchorX) / anchorSpanX));
        const spacerId = `spacer:${unit.id}:${succId}:${layer}`;
        const spacer = {
          id: spacerId,
          root: {
            id: spacerId,
            type: "text",
            text: "",
            x: 0,
            y: 0,
            width: SPACER_UNIT_SIZE,
            height: SPACER_UNIT_SIZE
          },
          attachments: [],
          width: SPACER_UNIT_SIZE,
          height: SPACER_UNIT_SIZE,
          layer,
          componentOrder: unit.componentOrder,
          creationIndex: unit.creationIndex,
          top: 0,
          predIds: /* @__PURE__ */ new Set([previous.id]),
          succIds: /* @__PURE__ */ new Set(),
          virtual: true,
          chainSourceId: unit.id,
          chainTargetId: succId,
          chainT
        };
        previous.succIds.add(spacerId);
        unitById.set(spacerId, spacer);
        units.push(spacer);
        previous = spacer;
      }
      previous.succIds.add(succId);
      succ.predIds.add(previous.id);
    }
  }
}
function computeLayerXPositions(context, units, unitById, unitIdByNodeId) {
  const nodeById = new Map(context.nodes.map((node) => [node.id, node]));
  const maxLayer = Math.max(...units.map((unit) => unit.layer));
  const layerWidths = /* @__PURE__ */ new Map();
  for (const unit of units) {
    layerWidths.set(unit.layer, Math.max(layerWidths.get(unit.layer) ?? 0, unit.width));
  }
  const tightBoundaries = /* @__PURE__ */ new Map();
  for (const edge of context.edges) {
    if (edge.fromSide === "bottom" && edge.toSide === "top") {
      continue;
    }
    const fromUnit = unitById.get(unitIdByNodeId.get(edge.fromNode) ?? "");
    const toUnit = unitById.get(unitIdByNodeId.get(edge.toNode) ?? "");
    if (!fromUnit || !toUnit || toUnit.layer - fromUnit.layer !== 1) {
      continue;
    }
    const fromNode = nodeById.get(edge.fromNode);
    const toNode = nodeById.get(edge.toNode);
    const isGateToDialogue = Boolean(
      fromNode && toNode && isGateNode(fromNode) && isDialogueFileNode(toNode)
    );
    const boundary = fromUnit.layer;
    const existing = tightBoundaries.get(boundary);
    tightBoundaries.set(boundary, existing === void 0 ? isGateToDialogue : existing && isGateToDialogue);
  }
  const xPositions = /* @__PURE__ */ new Map();
  let cursorX = 0;
  for (let layer = 0; layer <= maxLayer; layer += 1) {
    xPositions.set(layer, cursorX);
    const gapX = tightBoundaries.get(layer) ? MIN_HORIZONTAL_EDGE_GAP_X : LAYER_GAP_X;
    cursorX += (layerWidths.get(layer) ?? 0) + gapX;
  }
  return xPositions;
}
function assignUnitTops(units, unitById) {
  const unitsByLayer = /* @__PURE__ */ new Map();
  for (const unit of units) {
    const layerUnits = unitsByLayer.get(unit.layer) ?? [];
    layerUnits.push(unit);
    unitsByLayer.set(unit.layer, layerUnits);
  }
  const orderedLayers = [...unitsByLayer.keys()].sort((left, right) => left - right);
  for (const layer of orderedLayers) {
    const layerUnits = unitsByLayer.get(layer) ?? [];
    layerUnits.sort(
      (left, right) => left.componentOrder - right.componentOrder || left.creationIndex - right.creationIndex
    );
    let cursorY = 0;
    for (const unit of layerUnits) {
      unit.top = cursorY;
      cursorY += unit.height + LAYER_UNIT_GAP_Y;
    }
  }
  const unitAnchorY = (unit) => unit.top + unit.root.height / 2;
  const neighborAlignedCenter = (unit, neighborIds) => {
    let total = 0;
    let count = 0;
    for (const neighborId of neighborIds) {
      const neighbor = unitById.get(neighborId);
      if (!neighbor) {
        continue;
      }
      total += unitAnchorY(neighbor);
      count += 1;
    }
    return count > 0 ? total / count : null;
  };
  const relaxLayer = (layerUnits, mode) => {
    if (layerUnits.length === 0) {
      return;
    }
    const desiredCenters = /* @__PURE__ */ new Map();
    for (const unit of layerUnits) {
      const chainSource = unit.chainSourceId ? unitById.get(unit.chainSourceId) : void 0;
      const chainTarget = unit.chainTargetId ? unitById.get(unit.chainTargetId) : void 0;
      if (unit.virtual && chainSource && chainTarget && unit.chainT !== void 0) {
        const sourceCenter = unitAnchorY(chainSource);
        const targetCenter = unitAnchorY(chainTarget);
        desiredCenters.set(unit.id, sourceCenter + (targetCenter - sourceCenter) * unit.chainT);
        continue;
      }
      const neighborIds = mode === "preds" ? unit.predIds : mode === "succs" ? unit.succIds : /* @__PURE__ */ new Set([...unit.predIds, ...unit.succIds]);
      desiredCenters.set(unit.id, neighborAlignedCenter(unit, neighborIds) ?? unitAnchorY(unit));
    }
    const previousOrder = new Map(layerUnits.map((unit, index) => [unit.id, index]));
    const ordered = [...layerUnits].sort(
      (left, right) => (desiredCenters.get(left.id) ?? 0) - (desiredCenters.get(right.id) ?? 0) || (previousOrder.get(left.id) ?? 0) - (previousOrder.get(right.id) ?? 0)
    );
    const minimumTops = [];
    let cumulativeTop = 0;
    for (let index = 0; index < ordered.length; index += 1) {
      minimumTops.push(cumulativeTop);
      const unit = ordered[index];
      const next = ordered[index + 1];
      if (!unit || !next) {
        continue;
      }
      cumulativeTop += unit.height + verticalUnitGap(unit, next);
    }
    const desiredOffsets = ordered.map((unit, index) => {
      const desiredTop = (desiredCenters.get(unit.id) ?? 0) - unit.root.height / 2;
      return desiredTop - (minimumTops[index] ?? 0);
    });
    const compactOffsets = compactIncreasingOffsets(desiredOffsets);
    for (let index = 0; index < ordered.length; index += 1) {
      const unit = ordered[index];
      if (!unit) {
        continue;
      }
      unit.top = (compactOffsets[index] ?? 0) + (minimumTops[index] ?? 0);
    }
    layerUnits.length = 0;
    layerUnits.push(...ordered);
  };
  const sweepCount = 6;
  for (let sweep = 0; sweep < sweepCount; sweep += 1) {
    for (const layer of orderedLayers) {
      relaxLayer(unitsByLayer.get(layer) ?? [], "preds");
    }
    for (const layer of [...orderedLayers].reverse()) {
      relaxLayer(unitsByLayer.get(layer) ?? [], "succs");
    }
  }
  for (const layer of orderedLayers) {
    relaxLayer(unitsByLayer.get(layer) ?? [], "both");
  }
}
function verticalUnitGap(upper, lower) {
  if (upper.virtual || lower.virtual) {
    return SPACER_UNIT_GAP_Y;
  }
  if (isChoiceNode(upper.root) && isChoiceNode(lower.root)) {
    return CHOICE_STACK_GAP_Y;
  }
  return LAYER_UNIT_GAP_Y;
}
function normalizeCanvasOrigin(context) {
  if (context.nodes.length === 0) {
    return;
  }
  const minimumX = Math.min(...context.nodes.map((node) => node.x));
  const targetX = context.nodes.some((node) => isAddTopicResultNode(node)) ? INTRODUCER_ORIGIN_X : 0;
  const deltaX = targetX - minimumX;
  if (deltaX === 0) {
    return;
  }
  for (const node of context.nodes) {
    node.x += deltaX;
  }
}
function isAddTopicResultNode(node) {
  return node.type === "text" && (node.text ?? "").startsWith("AddTopic ");
}
async function readDialogueDocuments(app2, projectRoot) {
  const documents = [];
  for (const dialogueType of DIALOGUE_TYPES) {
    const folderPath = normalizePath(`${projectRoot.path}/${dialogueType}`);
    const folder2 = app2.vault.getAbstractFileByPath(folderPath);
    if (!(folder2 instanceof TFolder)) {
      continue;
    }
    documents.push(...await readFolderMarkdownDocuments(app2, folder2));
  }
  return documents;
}
async function readFolderMarkdownDocuments(app2, folder2) {
  const files = collectMarkdownFiles(folder2);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return Promise.all(files.map((file) => readMarkdownDocument(app2, file)));
}
function collectMarkdownFiles(folder2) {
  const files = [];
  for (const child of folder2.children) {
    if (child instanceof TFile && child.extension === "md") {
      files.push(child);
      continue;
    }
    if (child instanceof TFolder) {
      files.push(...collectMarkdownFiles(child));
    }
  }
  return files;
}
async function readMarkdownDocument(app2, file) {
  const content = await app2.vault.read(file);
  const { frontmatter, body } = splitFrontmatter(content);
  const parsedFrontmatter = parseStructuredFrontmatter(frontmatter);
  const trimmedBody = body.trim();
  return {
    file,
    frontmatter: parsedFrontmatter,
    body: trimmedBody,
    canvasBodySubpath: resolveCanvasBodySubpath(file.path, parsedFrontmatter, trimmedBody)
  };
}
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
function resolveJournalQuestFolder(folder2, projectRoot) {
  if (folder2.parent?.path === normalizePath(`${projectRoot.path}/${JOURNAL_FOLDER_NAME}`)) {
    return folder2;
  }
  let current = folder2;
  while (current !== null && current.path.startsWith(`${projectRoot.path}/${JOURNAL_FOLDER_NAME}/`)) {
    if (current.parent?.path === normalizePath(`${projectRoot.path}/${JOURNAL_FOLDER_NAME}`)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}
function getImmediateChildFolders(root, childFolderName) {
  const target = root.children.find(
    (child) => child instanceof TFolder && child.name === childFolderName
  );
  if (!target) {
    return [];
  }
  return target.children.filter((child) => child instanceof TFolder);
}
function extractQuestTitle(documents) {
  const questNameDocument = documents.find((document) => isQuestNameNote(document));
  if (!questNameDocument) {
    return null;
  }
  const firstLine = firstNonEmptyLine(questNameDocument.body);
  if (!firstLine) {
    return null;
  }
  return stripWikilinkSyntax(stripBlockId(firstLine));
}
function isQuestNameNote(document) {
  return getStringValue(document.frontmatter, "Type") === "Journal" && getStringValue(document.frontmatter, QUEST_NAME_FIELD)?.toLowerCase() === "true";
}
function toJournalMilestone(document) {
  if (getStringValue(document.frontmatter, "Type") !== "Journal") {
    return null;
  }
  const questId = getStringValue(document.frontmatter, "Topic");
  const indexValue = getStringValue(document.frontmatter, "Index");
  if (!questId || !indexValue) {
    return null;
  }
  const index = Number.parseInt(indexValue, 10);
  if (!Number.isFinite(index)) {
    return null;
  }
  return {
    id: createNodeId(`milestone:${document.file.path}`),
    questId,
    questTitle: extractQuestTitle([document]) ?? questId,
    index,
    finished: getBooleanValue(document.frontmatter, "Finished"),
    file: document.file,
    summary: firstSentence(document.body),
    canvasSubpath: document.canvasBodySubpath
  };
}
function toDialogueRecord(document, questIds, phaseIndices) {
  const type = getStringValue(document.frontmatter, "Type");
  const topic = getStringValue(document.frontmatter, "Topic");
  if (!type || !topic || !isDialogueType(type)) {
    return null;
  }
  const conditionEntries = parseConditions(document.frontmatter, questIds);
  const resultActions = parseResultActions(getStringValue(document.frontmatter, "Result") ?? "", questIds);
  const bodyText = document.body.trim();
  const conditionQuestReferences = uniqueValues(
    conditionEntries.filter((condition) => condition.kind === "journal" && condition.questId).map((condition) => condition.questId)
  );
  const resultQuestReferences = uniqueValues(
    resultActions.filter((action) => action.kind === "journal-set" && action.targetQuestId).map((action) => action.targetQuestId)
  );
  const ownedQuestReferences = resultQuestReferences.length > 0 ? resultQuestReferences : conditionQuestReferences;
  const directRelevance = ownedQuestReferences.some((questId) => questIds.includes(questId));
  const phaseAnchor = determinePhaseAnchor(conditionEntries, resultActions, phaseIndices, questIds);
  return {
    id: createNodeId(`record:${document.file.path}`),
    type,
    topic,
    file: document.file,
    canvasSubpath: document.canvasBodySubpath,
    diagId: getStringValue(document.frontmatter, "DiagID") ?? "",
    prevId: getStringValue(document.frontmatter, "PrevID") ?? "",
    bodyText,
    conditions: conditionEntries,
    speakerConditions: conditionEntries.filter((condition) => condition.kind === "speaker"),
    nonSpeakerConditions: conditionEntries.filter((condition) => condition.kind !== "speaker"),
    resultActions,
    resultLines: resultActions.map((action) => action.displayText),
    phaseAnchor,
    sourcePhaseAnchor: phaseAnchor,
    directlyRelevant: directRelevance,
    conditionQuestReferences,
    resultQuestReferences,
    ownedQuestReferences,
    questReferences: uniqueValues([...conditionQuestReferences, ...resultQuestReferences]),
    infoOrder: Number.MAX_SAFE_INTEGER,
    primaryChoiceValue: firstChoiceValue(conditionEntries),
    choiceValues: conditionEntries.filter((condition) => condition.kind === "choice" && condition.choiceValue !== void 0).map((condition) => condition.choiceValue),
    choiceTargets: resultActions.filter((action) => action.kind === "choice-set" && action.choiceValue !== void 0).map((action) => action.choiceValue)
  };
}
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
        displayText: `Item - ${rawVariable}`,
        questId: itemCondition?.id,
        operator: itemCondition?.operator,
        value: itemCondition?.value
      });
      continue;
    }
    const prefix = rawFunction && rawFunction !== "Function" ? `${rawFunction} - ` : "";
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
      displayText: `Journal - ${rawVariable}`,
      questId: matchingQuestId
    };
  }
  const journalQuestId = journalMatch[1] ?? matchingQuestId;
  const journalOperator = normalizeNumericOperator(journalMatch[2]);
  const journalValue = journalMatch[3] ?? "0";
  return {
    kind: "journal",
    displayText: `Journal - ${rawVariable}`,
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
      choiceValue: Number.parseInt(choiceValue, 10)
    });
    match = choicePattern.exec(line);
  }
  return actions;
}
function resolvePropagatedRelevantRecords(allRecords, directRelevant, questIds) {
  const relevant = new Set(directRelevant);
  const recordsByTopic = groupRecordsByTopic(allRecords);
  const recordsByNormalizedTopic = groupRecordsByNormalizedTopic(allRecords);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of allRecords) {
      if (record.choiceTargets.length === 0 && !record.resultActions.some((action) => action.kind === "add-topic")) {
        continue;
      }
      if (hasOnlyJournalResultsForOtherQuests(record, questIds)) {
        continue;
      }
      const topicRecords = recordsByTopic.get(record.topic) ?? [];
      if (relevant.has(record.id)) {
        for (const candidate of resolveChoiceTargetRecords(record, topicRecords)) {
          if (hasOnlyJournalResultsForOtherQuests(candidate, questIds) || relevant.has(candidate.id)) {
            continue;
          }
          relevant.add(candidate.id);
          changed = true;
        }
        for (const candidate of resolveAddTopicTargetRecords(record, recordsByNormalizedTopic)) {
          if (hasOnlyJournalResultsForOtherQuests(candidate, questIds) || relevant.has(candidate.id)) {
            continue;
          }
          relevant.add(candidate.id);
          changed = true;
        }
        continue;
      }
      if (recordLeadsToRelevantRecord(record, topicRecords, recordsByNormalizedTopic, relevant)) {
        relevant.add(record.id);
        changed = true;
      }
    }
  }
  return relevant;
}
function recordLeadsToRelevantRecord(record, topicRecords, recordsByNormalizedTopic, relevant) {
  return resolveChoiceTargetRecords(record, topicRecords).some((candidate) => relevant.has(candidate.id)) || resolveAddTopicTargetRecords(record, recordsByNormalizedTopic).some((candidate) => relevant.has(candidate.id));
}
function resolveChoiceTargetRecords(sourceRecord, topicRecords) {
  const targetRecords = [];
  for (const candidate of topicRecords) {
    if (candidate.id === sourceRecord.id) {
      continue;
    }
    if (sourceRecord.choiceTargets.some((value) => candidate.choiceValues.includes(value) && conditionsCanFollowChoice(sourceRecord, candidate, value))) {
      targetRecords.push(candidate);
    }
  }
  return targetRecords;
}
function resolveAddTopicTargetRecords(sourceRecord, recordsByNormalizedTopic) {
  const targetRecords = [];
  for (const action of sourceRecord.resultActions) {
    if (action.kind !== "add-topic" || !action.targetTopic) {
      continue;
    }
    const resolvedTargets = resolveAddTopicTransitionTargets(sourceRecord, action.targetTopic, recordsByNormalizedTopic);
    for (const targetRecord of resolvedTargets) {
      if (!targetRecords.some((candidate) => candidate.id === targetRecord.id)) {
        targetRecords.push(targetRecord);
      }
    }
  }
  return targetRecords;
}
function resolveEffectiveQuestOwnership(allRecords) {
  const ancestorsByRecordId = buildAncestorRecordMap(allRecords);
  const resultOwnership = /* @__PURE__ */ new Map();
  const conditionOwnership = /* @__PURE__ */ new Map();
  for (const record of allRecords) {
    resultOwnership.set(record.id, new Set(record.resultQuestReferences));
    conditionOwnership.set(record.id, new Set(record.conditionQuestReferences));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of allRecords) {
      const ancestorIds = ancestorsByRecordId.get(record.id) ?? [];
      const descendantResultOwnership = resultOwnership.get(record.id) ?? /* @__PURE__ */ new Set();
      const descendantConditionOwnership = conditionOwnership.get(record.id) ?? /* @__PURE__ */ new Set();
      for (const ancestorId of ancestorIds) {
        const ancestorResultOwnership = resultOwnership.get(ancestorId) ?? /* @__PURE__ */ new Set();
        const ancestorConditionOwnership = conditionOwnership.get(ancestorId) ?? /* @__PURE__ */ new Set();
        if (mergeQuestReferences(ancestorResultOwnership, descendantResultOwnership)) {
          resultOwnership.set(ancestorId, ancestorResultOwnership);
          changed = true;
        }
        if (mergeQuestReferences(ancestorConditionOwnership, descendantConditionOwnership)) {
          conditionOwnership.set(ancestorId, ancestorConditionOwnership);
          changed = true;
        }
      }
    }
  }
  const effectiveOwnership = /* @__PURE__ */ new Map();
  for (const record of allRecords) {
    const recordResultOwnership = [...resultOwnership.get(record.id) ?? /* @__PURE__ */ new Set()];
    const recordConditionOwnership = [...conditionOwnership.get(record.id) ?? /* @__PURE__ */ new Set()];
    effectiveOwnership.set(
      record.id,
      recordResultOwnership.length > 0 ? uniqueValues(recordResultOwnership) : uniqueValues(recordConditionOwnership)
    );
  }
  return effectiveOwnership;
}
function buildAncestorRecordMap(allRecords) {
  const ancestorsByRecordId = /* @__PURE__ */ new Map();
  const recordsByTopic = groupRecordsByTopic(allRecords);
  for (const record of allRecords) {
    ancestorsByRecordId.set(record.id, /* @__PURE__ */ new Set());
  }
  for (const record of allRecords) {
    const recordAncestors = ancestorsByRecordId.get(record.id);
    if (!recordAncestors) {
      continue;
    }
    const topicRecords = recordsByTopic.get(record.topic) ?? [];
    for (const candidate of topicRecords) {
      if (candidate.id === record.id || candidate.choiceTargets.length === 0) {
        continue;
      }
      if (candidate.choiceTargets.some((value) => record.choiceValues.includes(value) && conditionsCanFollowChoice(candidate, record, value))) {
        recordAncestors.add(candidate.id);
      }
    }
  }
  return new Map(
    [...ancestorsByRecordId.entries()].map(([recordId, ancestorIds]) => [recordId, [...ancestorIds]])
  );
}
function mergeQuestReferences(target, source) {
  let changed = false;
  for (const questId of source) {
    if (target.has(questId)) {
      continue;
    }
    target.add(questId);
    changed = true;
  }
  return changed;
}
function groupBranchFamilies(records, questIds) {
  const familyMap = /* @__PURE__ */ new Map();
  for (const record of records) {
    const nonSpeakerKey = normalizeConditionKey(record.nonSpeakerConditions);
    const resultKey = record.resultActions.map((action) => action.displayText).join("|");
    const bodyKey = record.bodyText.trim();
    const familyKey = [record.type, record.topic, record.phaseAnchor, nonSpeakerKey, resultKey, bodyKey].join("::");
    const existing = familyMap.get(familyKey);
    if (existing) {
      existing.records.push(record);
      continue;
    }
    const progressionTarget = firstJournalResult(record.resultActions, questIds);
    familyMap.set(familyKey, {
      id: createNodeId(`family:${familyKey}`),
      type: record.type,
      topic: record.topic,
      phaseAnchor: record.phaseAnchor,
      records: [record],
      sharedConditions: record.nonSpeakerConditions,
      results: record.resultActions,
      bodyText: record.bodyText,
      priority: computeFamilyPriority(record.phaseAnchor, progressionTarget, record.resultActions),
      progressionTarget
    });
  }
  return [...familyMap.values()];
}
function compareBranchFamilies(left, right) {
  if (left.type === right.type && left.topic === right.topic) {
    return compareFamilyChoiceBreadth(left, right) || compareFamilyInfoOrder(left, right) || left.priority - right.priority || compareNullableNumbers(left.progressionTarget, right.progressionTarget) || left.records[0]?.file.path.localeCompare(right.records[0]?.file.path ?? "") || 0;
  }
  return left.priority - right.priority || compareNullableNumbers(left.progressionTarget, right.progressionTarget) || left.topic.localeCompare(right.topic) || left.records[0]?.file.path.localeCompare(right.records[0]?.file.path ?? "") || 0;
}
function compareFamilyChoiceBreadth(left, right) {
  const leftChoices = familyChoiceValues(left);
  const rightChoices = familyChoiceValues(right);
  if (leftChoices.length === 0 && rightChoices.length === 0) {
    return 0;
  }
  return leftChoices.length - rightChoices.length || compareNullableNumbers(maxNumber(leftChoices), maxNumber(rightChoices));
}
function familyChoiceValues(family) {
  return uniqueNumbers(
    family.results.filter((action) => action.kind === "choice-set" && action.choiceValue !== void 0).map((action) => action.choiceValue)
  );
}
function maxNumber(values) {
  return values.length > 0 ? Math.max(...values) : null;
}
function compareDialogueRecords(left, right) {
  return compareInfoOrder(left, right) || normalizeConditionKey(left.speakerConditions).localeCompare(normalizeConditionKey(right.speakerConditions)) || left.file.path.localeCompare(right.file.path);
}
function compareFamilyInfoOrder(left, right) {
  return minFamilyInfoOrder(left) - minFamilyInfoOrder(right);
}
function minFamilyInfoOrder(family) {
  return Math.min(...family.records.map((record) => record.infoOrder), Number.MAX_SAFE_INTEGER);
}
function compareInfoOrder(left, right) {
  if (left.topic !== right.topic || left.type !== right.type) {
    return 0;
  }
  return left.infoOrder - right.infoOrder;
}
function determinePhaseAnchor(conditions, resultActions, phaseIndices, questIds) {
  const conditionAnchor = determineJournalConditionPhaseAnchor(conditions, phaseIndices, questIds);
  const journalResult = firstJournalResultAction(resultActions, questIds);
  if (journalResult?.targetJournalIndex !== void 0) {
    const resultAnchor = previousPhaseBefore(journalResult.targetJournalIndex, phaseIndices);
    if (!conditions.some((condition) => condition.kind === "choice") || journalResultCanRunBeforeTarget(conditions, journalResult)) {
      return resultAnchor;
    }
  }
  if (conditionAnchor !== null && conditions.some((condition) => condition.kind === "choice")) {
    return conditionAnchor;
  }
  if (conditionAnchor !== null) {
    return conditionAnchor;
  }
  return phaseIndices[0] ?? 0;
}
function journalResultCanRunBeforeTarget(conditions, resultAction) {
  if (resultAction.targetQuestId === void 0 || resultAction.targetJournalIndex === void 0) {
    return true;
  }
  const targetQuestConditions = conditions.filter(
    (condition) => condition.kind === "journal" && condition.questId === resultAction.targetQuestId && condition.value !== void 0
  );
  if (targetQuestConditions.length === 0) {
    return true;
  }
  return targetQuestConditions.every(
    (condition) => journalConditionAllowsValueBeforeTarget(condition, resultAction.targetJournalIndex)
  );
}
function journalConditionAllowsValueBeforeTarget(condition, targetJournalIndex) {
  if (condition.value === void 0) {
    return true;
  }
  switch (condition.operator) {
    case "=":
    case "==":
      return condition.value < targetJournalIndex;
    case ">":
    case ">=":
      return condition.value < targetJournalIndex;
    case "<":
    case "<=":
      return targetJournalIndex > PRE_JOURNAL_PHASE;
    case "!=":
    default:
      return condition.value !== PRE_JOURNAL_PHASE || targetJournalIndex > PRE_JOURNAL_PHASE + 1;
  }
}
function determineJournalConditionPhaseAnchor(conditions, phaseIndices, questIds) {
  const journalConditions = conditions.filter(
    (condition) => condition.kind === "journal" && condition.value !== void 0 && condition.questId !== void 0 && questIds.includes(condition.questId)
  );
  if (journalConditions.length === 0) {
    return conditions.some((condition) => condition.kind === "journal") ? phaseIndices[0] ?? 0 : null;
  }
  const matchingPhases = phaseIndices.filter(
    (phaseValue) => journalConditions.every((condition) => journalConditionMatches(phaseValue, condition))
  );
  if (matchingPhases.length > 0) {
    return matchingPhases[0] ?? phaseIndices[0] ?? 0;
  }
  return nearestPhaseForJournalCondition(journalConditions[0], phaseIndices);
}
function linkedJournalConditionPhases(conditions, milestones, questIds) {
  const journalConditions = conditions.filter(
    (condition) => condition.kind === "journal" && condition.value !== void 0 && condition.questId !== void 0 && questIds.includes(condition.questId)
  );
  if (journalConditions.length === 0) {
    return [];
  }
  const conditionsByQuest = groupJournalConditionsByQuest(journalConditions);
  const matchingMilestones = milestones.filter((milestone) => milestone.index > 0).filter((milestone) => {
    const questConditions = conditionsByQuest.get(milestone.questId);
    return questConditions !== void 0 && questConditions.every((condition) => journalConditionMatches(milestone.index, condition));
  }).sort(compareJournalMilestones);
  const firstMatching = matchingMilestones[0];
  if (!firstMatching) {
    return [];
  }
  if (!firstMatching.finished) {
    return [firstMatching.index];
  }
  return uniqueNumbers(matchingMilestones.filter((milestone) => milestone.finished).map((milestone) => milestone.index));
}
function groupJournalConditionsByQuest(conditions) {
  const conditionsByQuest = /* @__PURE__ */ new Map();
  for (const condition of conditions) {
    if (condition.questId === void 0) {
      continue;
    }
    const questConditions = conditionsByQuest.get(condition.questId) ?? [];
    questConditions.push(condition);
    conditionsByQuest.set(condition.questId, questConditions);
  }
  return conditionsByQuest;
}
function compareJournalMilestones(left, right) {
  const byIndex = left.index - right.index;
  if (byIndex !== 0) {
    return byIndex;
  }
  return left.file.path.localeCompare(right.file.path);
}
function nearestPhaseForJournalCondition(condition, phaseIndices) {
  if (!condition || condition.value === void 0) {
    return phaseIndices[0] ?? 0;
  }
  switch (condition.operator) {
    case ">":
      return firstPhaseAbove(condition.value, phaseIndices) ?? nearestPhaseAtOrBelow(condition.value, phaseIndices);
    case ">=":
    case "=":
    case "==":
      return firstPhaseAtOrAbove(condition.value, phaseIndices) ?? nearestPhaseAtOrBelow(condition.value, phaseIndices);
    case "<":
      return lastPhaseBelow(condition.value, phaseIndices) ?? phaseIndices[0] ?? condition.value;
    case "<=":
      return nearestPhaseAtOrBelow(condition.value, phaseIndices);
    case "!=":
    default:
      return nearestPhaseAtOrBelow(condition.value, phaseIndices);
  }
}
function nearestPhaseAtOrBelow(value, phaseIndices) {
  const eligible = phaseIndices.filter((phaseValue) => phaseValue <= value);
  if (eligible.length > 0) {
    return eligible[eligible.length - 1] ?? phaseIndices[0] ?? value;
  }
  return phaseIndices[0] ?? value;
}
function firstPhaseAtOrAbove(value, phaseIndices) {
  return phaseIndices.find((phaseValue) => phaseValue >= value) ?? null;
}
function firstPhaseAbove(value, phaseIndices) {
  return phaseIndices.find((phaseValue) => phaseValue > value) ?? null;
}
function lastPhaseBelow(value, phaseIndices) {
  const lower = phaseIndices.filter((phaseValue) => phaseValue < value);
  return lower[lower.length - 1] ?? null;
}
function previousPhaseBefore(value, phaseIndices) {
  const lower = phaseIndices.filter((phaseValue) => phaseValue < value);
  if (lower.length > 0) {
    return lower[lower.length - 1] ?? phaseIndices[0] ?? value;
  }
  return Math.min(PRE_JOURNAL_PHASE, value);
}
function computeFamilyPriority(phaseAnchor, progressionTarget, resultActions) {
  if (progressionTarget !== null && progressionTarget > phaseAnchor) {
    return 0;
  }
  if (resultActions.some((action) => action.kind === "choice-set")) {
    return 1;
  }
  if (progressionTarget !== null && progressionTarget <= phaseAnchor) {
    return 3;
  }
  return 2;
}
function firstJournalResult(resultActions, questIds) {
  return firstJournalResultAction(resultActions, questIds)?.targetJournalIndex ?? null;
}
function firstJournalResultAction(resultActions, questIds) {
  let earliestTarget = null;
  let earliestAction = null;
  for (const action of resultActions) {
    if (action.kind === "journal-set" && action.targetJournalIndex !== void 0 && action.targetQuestId !== void 0 && questIds.includes(action.targetQuestId)) {
      if (earliestTarget === null || action.targetJournalIndex < earliestTarget) {
        earliestTarget = action.targetJournalIndex;
        earliestAction = action;
      }
    }
  }
  return earliestAction;
}
function addFileNode(context, seed, filePath, x, y, width, height, color, subpath) {
  const nodeId = createNodeId(seed);
  if (!context.nodeIds.has(nodeId)) {
    const measuredHeight = measureFileNodeHeight(context, filePath, width);
    context.nodes.push({
      id: nodeId,
      type: "file",
      file: filePath,
      subpath: subpath ?? void 0,
      x,
      y,
      width,
      height: measuredHeight,
      color
    });
    context.nodeIds.add(nodeId);
  } else if (subpath) {
    const node = context.nodes.find((candidate) => candidate.id === nodeId);
    if (node?.type === "file" && !node.subpath) {
      node.subpath = subpath;
    }
  }
  return nodeId;
}
function measureFileNodeHeight(context, filePath, width) {
  const bodyText = context.fileBodyTextByPath.get(filePath);
  if (!bodyText) {
    return FILE_NODE_MIN_HEIGHT;
  }
  return measureCanvasBodyHeight(bodyText, width);
}
function measureCanvasBodyHeight(bodyText, width) {
  const visibleText = normalizeCanvasBodyText(bodyText);
  if (visibleText.length === 0) {
    return FILE_NODE_MIN_HEIGHT;
  }
  return Math.max(FILE_NODE_MIN_HEIGHT, measureTextHeight(visibleText, width) + FILE_NODE_PADDING_Y);
}
function addTextNode(context, seed, text, x, y, width, color) {
  const nodeId = createNodeId(seed);
  if (!context.nodeIds.has(nodeId)) {
    context.nodes.push({
      id: nodeId,
      type: "text",
      text,
      x,
      y,
      width,
      height: measureTextHeight(text, width),
      color
    });
    context.nodeIds.add(nodeId);
  }
  return nodeId;
}
function addEdge(context, seed, fromNode, fromSide, toNode, toSide, label) {
  const edgeId = createEdgeId(seed);
  if (context.edgeIds.has(edgeId) || fromNode === toNode) {
    return;
  }
  context.edges.push({
    id: edgeId,
    fromNode,
    fromSide,
    toNode,
    toSide,
    ...label ? { label } : {}
  });
  context.edgeIds.add(edgeId);
}
function nodeCanReach(context, fromNode, toNode) {
  const outgoingEdgesByNode = /* @__PURE__ */ new Map();
  for (const edge of context.edges) {
    const outgoingEdges = outgoingEdgesByNode.get(edge.fromNode) ?? [];
    outgoingEdges.push(edge);
    outgoingEdgesByNode.set(edge.fromNode, outgoingEdges);
  }
  const queue = [fromNode];
  const visited = /* @__PURE__ */ new Set();
  while (queue.length > 0) {
    const currentNode = queue.shift();
    if (currentNode === void 0 || visited.has(currentNode)) {
      continue;
    }
    if (currentNode === toNode) {
      return true;
    }
    visited.add(currentNode);
    for (const edge of outgoingEdgesByNode.get(currentNode) ?? []) {
      if (!visited.has(edge.toNode)) {
        queue.push(edge.toNode);
      }
    }
  }
  return false;
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
function groupRecordsByTopic(records) {
  const grouped = /* @__PURE__ */ new Map();
  for (const record of records) {
    const topicRecords = grouped.get(record.topic) ?? [];
    topicRecords.push(record);
    grouped.set(record.topic, topicRecords);
  }
  return grouped;
}
function groupRecordsByNormalizedTopic(records) {
  const grouped = /* @__PURE__ */ new Map();
  for (const record of records) {
    const topicKey = normalizeTopicKey(record.topic);
    const topicRecords = grouped.get(topicKey) ?? [];
    topicRecords.push(record);
    grouped.set(topicKey, topicRecords);
  }
  for (const [topicKey, topicRecords] of grouped) {
    grouped.set(topicKey, orderTopicRecordsByInfoSequence(topicRecords));
  }
  return grouped;
}
function firstChoiceValue(conditions) {
  const choiceValues = conditions.filter((condition) => condition.kind === "choice" && condition.choiceValue !== void 0).map((condition) => condition.choiceValue);
  if (choiceValues.length === 0) {
    return null;
  }
  return Math.min(...choiceValues);
}
function hasOnlyJournalResultsForOtherQuests(record, questIds) {
  const journalResults = record.resultActions.filter(
    (action) => action.kind === "journal-set" && Boolean(action.targetQuestId)
  );
  return journalResults.length > 0 && journalResults.every((action) => !questIds.includes(action.targetQuestId));
}
function containsJournalLine(lines) {
  return lines.some((line) => line.startsWith("Journal [["));
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
  return `Journal [[${toWikilinkTarget(targetMilestone.file.path, targetMilestone.canvasSubpath)}|${label}]]`;
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
function toWikilinkTarget(filePath, subpath) {
  const fileName = filePath.split("/").pop() ?? filePath;
  const linkPath = fileName.replace(/\.md$/i, "");
  return `${linkPath}${subpath ?? ""}`;
}
function incrementPhaseCount(target, phaseValue) {
  target.set(phaseValue, (target.get(phaseValue) ?? 0) + 1);
}
function firstSentence(text) {
  const line = firstNonEmptyLine(text);
  if (!line) {
    return "";
  }
  const sentenceMatch = stripBlockId(line).match(/^(.+?[.!?])(?:\s|$)/);
  return sentenceMatch?.[1] ?? stripBlockId(line);
}
function firstNonEmptyLine(text) {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}
function stripBlockId(text) {
  return text.replace(/\s+\^[A-Za-z0-9_-]+$/, "").trim();
}
function resolveCanvasBodySubpath(filePath, frontmatter, body) {
  if (body.length === 0) {
    return null;
  }
  const type = getStringValue(frontmatter, "Type");
  if (!type || !CANVAS_BODY_BLOCK_TYPES.has(type)) {
    return null;
  }
  const existingBlockId = trailingBodyBlockId(body);
  return `#^${existingBlockId ?? createCanvasBodyBlockId(filePath)}`;
}
function createCanvasBodyBlockId(filePath) {
  return `${CANVAS_BODY_BLOCK_PREFIX}-${stableHash(filePath).slice(0, 10)}`;
}
function trailingBodyBlockId(body) {
  const line = firstNonEmptyLineFromEnd(body);
  if (!line) {
    return null;
  }
  return trailingBlockId(line);
}
function firstNonEmptyLineFromEnd(text) {
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = (lines[index] ?? "").trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}
function trailingBlockId(text) {
  const match = text.match(/\s+\^([A-Za-z0-9_-]+)\s*$/);
  return match?.[1] ?? null;
}
function normalizeQuestNameKey(text) {
  if (!text) {
    return null;
  }
  const normalized = stripWikilinkSyntax(stripBlockId(text)).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}
function normalizeTopicKey(text) {
  return stripWikilinkSyntax(stripQuotes(text)).toLowerCase().replace(/\s+/g, " ").trim();
}
function stripWikilinkSyntax(text) {
  return text.replace(/\[\[(?:[^|\]]*?\|)?([^|\]]*?)\]\]/g, "$1").trim();
}
function normalizeConditionKey(conditions) {
  return conditions.map((condition) => condition.displayText).sort().join("|");
}
function sanitizeFileName(input) {
  const sanitized = [...input].map((character) => {
    const reserved = '<>:"/\\|?*'.includes(character);
    const control = character.charCodeAt(0) < 32;
    return reserved || control ? "_" : character;
  }).join("").replace(/[. ]+$/g, "").trim();
  return sanitized.length > 0 ? sanitized : "quest";
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
function getBooleanValue(frontmatter, key) {
  return getStringValue(frontmatter, key)?.toLowerCase() === "true";
}
function isDialogueType(value) {
  return DIALOGUE_TYPES.includes(value);
}
function uniqueValues(values) {
  const seen = /* @__PURE__ */ new Set();
  const unique = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(value.trim());
  }
  return unique;
}
function uniqueNumbers(values) {
  return [...new Set(values)].sort((left, right) => left - right);
}
function compareNullableNumbers(left, right) {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
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
function normalizeCanvasBodyText(text) {
  let lastNonEmptyLine = -1;
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if ((lines[index] ?? "").trim().length > 0) {
      lastNonEmptyLine = index;
      break;
    }
  }
  return text.split("\n").map((line, index) => {
    return index === lastNonEmptyLine ? stripBlockId(line).trimEnd() : line.trimEnd();
  }).join("\n").trim();
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

// scripts/canvas-harness/harness-entry.mjs
var FakeVault = class {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.byPath = /* @__PURE__ */ new Map();
  }
  async init() {
    const root = new TFolder();
    root.path = "/";
    root.name = "";
    root.vault = this;
    this.byPath.set("/", root);
    await this.addChildren(root, this.rootDir);
    return this;
  }
  async addChildren(folder2, dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const childPath = folder2.path === "/" ? entry.name : `${folder2.path}/${entry.name}`;
      const diskPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const child = new TFolder();
        child.path = childPath;
        child.name = entry.name;
        child.parent = folder2;
        child.vault = this;
        folder2.children.push(child);
        this.byPath.set(childPath, child);
        await this.addChildren(child, diskPath);
      } else {
        const child = new TFile();
        child.path = childPath;
        child.name = entry.name;
        const dot = entry.name.lastIndexOf(".");
        child.basename = dot === -1 ? entry.name : entry.name.slice(0, dot);
        child.extension = dot === -1 ? "" : entry.name.slice(dot + 1);
        child.parent = folder2;
        child.vault = this;
        folder2.children.push(child);
        this.byPath.set(childPath, child);
      }
    }
  }
  getAbstractFileByPath(filePath) {
    return this.byPath.get(normalizePath(filePath)) ?? null;
  }
  async read(file) {
    return fs.readFile(path.join(this.rootDir, file.path), "utf8");
  }
};
var [vaultDir, questFolderPath, outFile] = process.argv.slice(2);
if (!vaultDir || !questFolderPath || !outFile) {
  console.error("usage: node harness.bundle.mjs <vaultDir> <questFolderPath> <outFile>");
  process.exit(1);
}
var vault = await new FakeVault(path.resolve(vaultDir)).init();
var app = { vault, metadataCache: null };
var folder = vault.getAbstractFileByPath(questFolderPath);
if (!(folder instanceof TFolder)) {
  console.error(`quest folder not found in vault: ${questFolderPath}`);
  process.exit(1);
}
var scope = await discoverQuestScope(app, folder);
var buildResult = await buildQuestCanvas(app, scope);
var canvasJson = JSON.stringify(
  {
    nodes: buildResult.nodes,
    edges: buildResult.edges,
    metadata: { version: "1.0-1.0", frontmatter: {} }
  },
  null,
  "	"
);
await fs.mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
await fs.writeFile(path.resolve(outFile), canvasJson, "utf8");
console.log(`quest: ${scope.questTitle}`);
console.log(`nodes: ${buildResult.nodes.length}, edges: ${buildResult.edges.length}`);
if (buildResult.warnings.length > 0) {
  console.log(`warnings: ${buildResult.warnings.join(" | ")}`);
}
console.log(`wrote ${outFile}`);
