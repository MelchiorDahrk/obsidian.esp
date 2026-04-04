use crate::parse::{FilterValue, ParsedPlugin};
use anyhow::{Result, ensure};
use merge_to_master::{DialogueGroup, PluginData};
use std::fmt::Write;
use tes3::esp::{
    Dialogue, DialogueData, DialogueInfo, FileType, Filter, FilterFunction, FilterType, Header,
    ObjectFlags, QuestState, Sex,
};

pub mod resolve;

use std::collections::{HashMap, HashSet};

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
        let dialogue_type = parsed_info
            .frontmatter
            .dialogue_type
            .unwrap_or(tes3::esp::DialogueType2::Topic);

        let topic_key = parsed_info.topic.to_ascii_lowercase();
        if parsed_info.frontmatter.diag_id.is_some() || parsed_info.frontmatter.prev_id.is_some() {
            groups_with_preserved_links.insert(topic_key.clone());
        }
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

        // Collect the set of IDs already present in this group (to guarantee uniqueness).
        let existing_ids = group.infos.iter().map(|i| i.id.clone()).collect();

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

        // Preserve an authored prev_id verbatim. When it is omitted, fall back to
        // the previously generated info id for this topic only.
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

        last_ids_by_topic.insert(topic_key, id.clone());

        let info = DialogueInfo {
            flags: ObjectFlags::empty(),
            id,
            prev_id,
            next_id: String::new(), // Filled by repair_links
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

        group.insert_info(info);
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
