//! Compilation: lowers a [`ParsedPlugin`] into native TES3 records.
//!
//! The main entry point is [`compile`], which builds the plugin header,
//! converts every parsed dialogue info into a [`DialogueInfo`] record grouped
//! by topic, and repairs the prev/next linked-list pointers that the engine
//! uses to order responses. Submodules handle the surrounding passes:
//!
//! - [`validate`] — checks authored references (IDs, factions, cells, script
//!   variables, ...) against master plugins and produces a warning log.
//! - [`resolve`] — merges the compiled plugin with its masters and diffs the
//!   result so only genuinely modified records ship in the final `.esp`.

use crate::parse::{FilterValue, ParsedInfo, ParsedPlugin};
use anyhow::{Result, ensure};
use merge_to_master::{DialogueGroup, PluginData};
use std::fmt::Write;
use tes3::esp::{
    Dialogue, DialogueData, DialogueInfo, FileType, Filter, FilterFunction, FilterType, Header,
    ObjectFlags, QuestState, Sex,
};

pub mod resolve;
pub mod validate;

use std::collections::{HashMap, HashSet};

/// The engine's fixed set of greeting topics; `Greeting`-type files must live
/// under one of these topic names.
const VALID_GREETING_TOPICS: &[&str] = &[
    "Greeting 0",
    "Greeting 1",
    "Greeting 2",
    "Greeting 3",
    "Greeting 4",
    "Greeting 5",
    "Greeting 6",
    "Greeting 7",
    "Greeting 8",
    "Greeting 9",
];

/// The engine's fixed set of persuasion-outcome topics.
const VALID_PERSUASION_TOPICS: &[&str] = &[
    "Admire Fail",
    "Admire Success",
    "Bribe Fail",
    "Bribe Success",
    "Info Refusal",
    "Intimidate Fail",
    "Intimidate Success",
    "Service Refusal",
    "Taunt Fail",
    "Taunt Success",
];

/// The engine's fixed set of voice-line topics.
const VALID_VOICE_TOPICS: &[&str] = &[
    "Alarm", "Attack", "Flee", "Hello", "Hit", "Idle", "Intruder", "Thief",
];

/// Generates a unique, numeric-only `DialogueInfo` ID within the given set of IDs.
///
/// The Morrowind engine requires INFO IDs to be numeric strings (INAM subrecord).
fn generate_info_id(existing_ids: &HashSet<String>) -> String {
    let mut id = String::new();
    loop {
        id.clear();
        let a: u16 = rand::random::<u16>() & 0x7FFF;
        let b: u16 = rand::random::<u16>() & 0x7FFF;
        let c: u16 = rand::random::<u16>() & 0x7FFF;
        let d: u16 = rand::random::<u16>() & 0x7FFF;
        write!(id, "{}{}{}{}", a, b, c, d).unwrap();
        if !existing_ids.contains(&id) {
            return id;
        }
    }
}

/// Generates `parse_filter_function_name`, a case-insensitive string ->
/// [`FilterFunction`] lookup covering every variant listed in the invocation
/// below. Keeping the list in a macro avoids hand-writing ~80 match arms.
macro_rules! parse_filter_functions {
    ($($name:ident),+ $(,)?) => {
        fn parse_filter_function_name(name: &str) -> Option<FilterFunction> {
            $(
                if name.eq_ignore_ascii_case(stringify!($name)) {
                    return Some(FilterFunction::$name);
                }
            )+
            None
        }
    };
}

parse_filter_functions!(
    ReactionLow,
    ReactionHigh,
    RankRequirement,
    Reputation,
    HealthPercent,
    PcReputation,
    PcLevel,
    PcHealthPercent,
    PcMagicka,
    PcFatigue,
    PcStrength,
    PcBlock,
    PcArmorer,
    PcMediumArmor,
    PcHeavyArmor,
    PcBluntWeapon,
    PcLongBlade,
    PcAxe,
    PcSpear,
    PcAthletics,
    PcEnchant,
    PcDestruction,
    PcAlteration,
    PcIllusion,
    PcConjuration,
    PcMysticism,
    PcRestoration,
    PcAlchemy,
    PcUnarmored,
    PcSecurity,
    PcSneak,
    PcAcrobatics,
    PcLightArmor,
    PcShortBlade,
    PcMarksman,
    PcMercantile,
    PcSpeechcraft,
    PcHandToHand,
    PcSex,
    PcExpelled,
    PcCommonDisease,
    PcBlightDisease,
    PcClothingModifier,
    PcCrimeLevel,
    SameSex,
    SameRace,
    SameFaction,
    FactionRankDifference,
    Detected,
    Alarmed,
    Choice,
    PcIntelligence,
    PcWillpower,
    PcAgility,
    PcSpeed,
    PcEndurance,
    PcPersonality,
    PcLuck,
    PcCorprus,
    Weather,
    PcVampire,
    Level,
    Attacked,
    TalkedToPc,
    PcHealth,
    CreatureTarget,
    FriendHit,
    Fight,
    Hello,
    Alarm,
    Flee,
    ShouldAttack,
    Werewolf,
    WerewolfKills,
    NotClass,
    DeadType,
    NotFaction,
    ItemType,
    JournalType,
    NotCell,
    NotRace,
    NotIdType,
    Global,
    PcGold,
    CompareGlobal,
    CompareLocal,
    VariableCompare
);

/// Resolves a `FilterFunction` from a `FilterType` and an optional function name string.
///
/// Handles mapping generic type conditions (like `Journal`, `Item`) to their specific
/// internal enum variants and parsing function names for `FilterType::Function`.
fn filter_function_from_parts(
    filter_type: FilterType,
    function_name: Option<&str>,
) -> Result<FilterFunction> {
    let function = match filter_type {
        FilterType::Function => function_name
            .and_then(parse_filter_function_name)
            .unwrap_or_default(),
        FilterType::Global | FilterType::Local | FilterType::NotLocal => function_name
            .and_then(parse_filter_function_name)
            .unwrap_or(FilterFunction::VariableCompare),
        FilterType::Journal => FilterFunction::JournalType,
        FilterType::Item => FilterFunction::ItemType,
        FilterType::Dead => FilterFunction::DeadType,
        FilterType::NotId => FilterFunction::NotIdType,
        FilterType::NotFaction => FilterFunction::NotFaction,
        FilterType::NotClass => FilterFunction::NotClass,
        FilterType::NotRace => FilterFunction::NotRace,
        FilterType::NotCell => FilterFunction::NotCell,
        FilterType::None => FilterFunction::default(),
    };

    if matches!(filter_type, FilterType::Function) && function_name.is_some() {
        ensure!(
            function != FilterFunction::default()
                || function_name.is_some_and(|name| name.eq_ignore_ascii_case("ReactionLow")),
            "Unknown filter function: {}",
            function_name.unwrap()
        );
    }

    Ok(function)
}

/// Repairs the `next_id` links in a `DialogueGroup` based on the current order of `infos`.
///
/// Unlike `group.repair_links()`, this function ONLY updates `next_id` and leaves
/// `prev_id` untouched. This is crucial for topics where the user has manually
/// specified a chain via `PrevID` fields.
fn repair_next_links(group: &mut DialogueGroup) {
    let infos = group.infos.make_contiguous();

    for info in infos.iter_mut() {
        info.next_id.clear();
    }

    for index in 0..infos.len().saturating_sub(1) {
        let next_id = infos[index + 1].id.clone();
        infos[index].next_id = next_id;
    }
}

/// Validates that a topic name is valid for its dialogue type (e.g. valid Greetings,
/// valid Voice commands).
fn validate_dialogue_topic(dialogue_type: tes3::esp::DialogueType2, topic: &str) -> Result<()> {
    let valid_topics = match dialogue_type {
        tes3::esp::DialogueType2::Greeting => Some(VALID_GREETING_TOPICS),
        tes3::esp::DialogueType2::Persuasion => Some(VALID_PERSUASION_TOPICS),
        tes3::esp::DialogueType2::Voice => Some(VALID_VOICE_TOPICS),
        tes3::esp::DialogueType2::Topic | tes3::esp::DialogueType2::Journal => None,
    };

    if let Some(valid_topics) = valid_topics {
        ensure!(
            valid_topics
                .iter()
                .any(|valid_topic| valid_topic.eq_ignore_ascii_case(topic)),
            "Invalid {} topic '{}'. Expected one of: {}",
            match dialogue_type {
                tes3::esp::DialogueType2::Greeting => "Greeting",
                tes3::esp::DialogueType2::Persuasion => "Persuasion",
                tes3::esp::DialogueType2::Voice => "Voice",
                tes3::esp::DialogueType2::Topic | tes3::esp::DialogueType2::Journal =>
                    unreachable!(),
            },
            topic,
            valid_topics.join(", ")
        );
    }

    Ok(())
}

/// Compiles a `ParsedPlugin` (internal Markdown representation) into a `PluginData`
/// (native TES3 record representation).
pub fn compile(parsed: ParsedPlugin) -> Result<PluginData> {
    let mut plugin = PluginData::new();
    let mut groups_with_preserved_links = HashSet::new();

    // 1. Build Header
    plugin.header = Header {
        flags: ObjectFlags::empty(),
        version: 1.3,
        file_type: match parsed.header.file_type.to_lowercase().as_str() {
            "esm" => FileType::Esm,
            "ess" => FileType::Ess,
            _ => FileType::Esp,
        },
        author: parsed.header.author.into(),
        description: parsed.header.description.into(),
        num_objects: 0,
        masters: vec![], // This gets updated during resolve pass
    };

    // 2. Build Dialogues
    let mut last_ids_by_topic: HashMap<String, String> = HashMap::new();

    for parsed_info in parsed.infos {
        let (topic_key, info) =
            compile_dialogue_info(parsed_info, &mut last_ids_by_topic, &mut plugin)?;

        if group_has_preserved_links(&info) {
            groups_with_preserved_links.insert(topic_key);
        }
    }

    for (topic_key, group) in plugin.dialogues.iter_mut() {
        if groups_with_preserved_links.contains(topic_key) {
            repair_next_links(group);
        } else {
            group.repair_links();
        }
    }

    Ok(plugin)
}

/// Determines if a specific dialogue info file requires its topic topic to use
/// manual link ordering (preserving existing author linkage) rather than automatic
/// alphabetical/temporal ordering.
fn group_has_preserved_links(info: &DialogueInfo) -> bool {
    // If DiagID or PrevID were authored, we assume manual ordering.
    // (Note: This is a bit of a heuristic since we're checking values not the presence
    // of the field in Markdown, but it matches the previous logic).
    !info.prev_id.is_empty()
}

/// Transforms a single `ParsedInfo` into a native TES3 `DialogueInfo` record.
///
/// This involves:
/// 1. Generating or validating the `DiagID`.
/// 2. Mapping human-readable types (Race, Class, etc.) to native formats.
/// 3. Compiling filters and script text.
/// 4. Resolving the `PrevID` link sequence.
///
/// The resulting record is inserted into the provided `PluginData` within the
/// appropriate `DialogueGroup`.
fn compile_dialogue_info(
    parsed_info: ParsedInfo,
    last_ids_by_topic: &mut HashMap<String, String>,
    plugin: &mut PluginData,
) -> Result<(String, DialogueInfo)> {
    let dialogue_type = parsed_info
        .frontmatter
        .dialogue_type
        .unwrap_or(tes3::esp::DialogueType2::Topic);
    validate_dialogue_topic(dialogue_type, &parsed_info.topic)?;

    let topic_key = parsed_info.topic.to_ascii_lowercase();
    let group = plugin
        .dialogues
        .entry(topic_key.clone())
        .or_insert_with(|| DialogueGroup {
            dialogue: Dialogue {
                flags: ObjectFlags::empty(),
                id: parsed_info.topic.clone(),
                dialogue_type,
            },
            infos: Default::default(),
        });

    let existing_ids: HashSet<String> = group.infos.iter().map(|i| i.id.clone()).collect();

    let id = if let Some(id) = &parsed_info.frontmatter.diag_id {
        ensure!(
            id.chars().all(|c| c.is_ascii_digit()),
            "DiagID must be numeric: {id}"
        );
        id.clone()
    } else {
        generate_info_id(&existing_ids)
    };

    let data = DialogueData {
        dialogue_type: match dialogue_type {
            tes3::esp::DialogueType2::Topic => tes3::esp::DialogueType::Topic,
            tes3::esp::DialogueType2::Voice => tes3::esp::DialogueType::Voice,
            tes3::esp::DialogueType2::Greeting => tes3::esp::DialogueType::Greeting,
            tes3::esp::DialogueType2::Persuasion => tes3::esp::DialogueType::Persuasion,
            tes3::esp::DialogueType2::Journal => tes3::esp::DialogueType::Journal,
        },
        disposition: parsed_info.frontmatter.disposition.unwrap_or(0),
        speaker_rank: parsed_info.frontmatter.speaker_rank.unwrap_or(-1),
        speaker_sex: match parsed_info.frontmatter.speaker_sex {
            Some(0) => Sex::Male,
            Some(1) => Sex::Female,
            _ => Sex::Any,
        },
        player_rank: parsed_info.frontmatter.player_rank.unwrap_or(-1),
    };

    let mut filters = Vec::new();
    for pf in parsed_info.frontmatter.filters {
        let filter_value = match pf.value {
            FilterValue::Float(f) => tes3::esp::FilterValue::Float(f),
            FilterValue::Integer(i) => tes3::esp::FilterValue::Integer(i),
        };

        let function_enum =
            filter_function_from_parts(pf.filter_type, pf.function_name.as_deref())?;

        filters.push(Filter {
            index: pf.index,
            filter_type: pf.filter_type,
            function: function_enum,
            comparison: pf.comparison,
            id: pf.id,
            value: filter_value,
        });
    }

    let quest_state = parsed_info
        .frontmatter
        .quest_state
        .and_then(|s| match s.as_str() {
            "Name" => Some(QuestState::Name),
            "Finished" => Some(QuestState::Finished),
            "Restart" => Some(QuestState::Restart),
            _ => None,
        });

    let prev_id = if let Some(pid) = &parsed_info.frontmatter.prev_id {
        ensure!(
            pid.chars().all(|c| c.is_ascii_digit()),
            "PrevID must be numeric: {pid}"
        );
        pid.clone()
    } else {
        last_ids_by_topic
            .get(&topic_key)
            .cloned()
            .unwrap_or_default()
    };

    last_ids_by_topic.insert(topic_key.clone(), id.clone());

    let info = DialogueInfo {
        flags: ObjectFlags::empty(),
        id,
        prev_id,
        next_id: String::new(),
        data,
        speaker_id: parsed_info.frontmatter.speaker_id.unwrap_or_default(),
        speaker_race: parsed_info.frontmatter.speaker_race.unwrap_or_default(),
        speaker_class: parsed_info.frontmatter.speaker_class.unwrap_or_default(),
        speaker_faction: parsed_info.frontmatter.speaker_faction.unwrap_or_default(),
        speaker_cell: parsed_info.frontmatter.speaker_cell.unwrap_or_default(),
        player_faction: parsed_info.frontmatter.player_faction.unwrap_or_default(),
        sound_path: parsed_info.frontmatter.sound_path.unwrap_or_default(),
        text: parsed_info.text,
        quest_state,
        filters,
        script_text: parsed_info.frontmatter.script_text.unwrap_or_default(),
    };

    let info_clone = info.clone();
    group.insert_info(info);

    Ok((topic_key, info_clone))
}
