//! Reference validation: checks an authored project against its master
//! plugins before compilation.
//!
//! Validation never fails the build — it produces a human-readable warning log
//! (shown in the Obsidian plugin's compile output) flagging references that
//! don't resolve: unknown NPC/faction/class/race/cell IDs, missing journal
//! topics, and local script variables that don't exist on the speaker's
//! attached script.

use crate::parse::{ParsedFilter, ParsedInfo, ParsedPlugin};
use anyhow::Result;
use std::collections::{HashMap, HashSet};
use tes3::esp::{DialogueType2, FilterType, Plugin, TES3Object};

/// Lookup tables built from the master plugins. All keys are stored
/// lowercased; lookups must lowercase their needle to match.
#[derive(Default)]
struct ValidationDatabase {
    /// NPC and creature record IDs.
    actor_ids: HashSet<String>,
    class_ids: HashSet<String>,
    faction_ids: HashSet<String>,
    global_ids: HashSet<String>,
    /// Journal topic IDs from masters *plus* journal topics defined by the
    /// project being validated (so new quests can reference themselves).
    journal_topics: HashSet<String>,
    /// Every identifiable record ID of any type (for `Item` filters).
    object_ids: HashSet<String>,
    race_ids: HashSet<String>,
    /// Interior/exterior cell display names.
    cell_names: HashSet<String>,
    /// Actor ID -> ID of the script attached to that actor.
    actor_scripts: HashMap<String, String>,
    /// Script ID -> names of the local variables it declares.
    script_variables: HashMap<String, HashSet<String>>,
}

/// Validates an authored project against a set of master plugins.
///
/// It checks that:
/// - All referenced record IDs (NPCs, Factions, Classes, etc.) exist in the masters.
/// - Cell names are valid.
/// - Local variables referenced in dialogue filters exist on the script attached to the speaker.
/// - Journal topics exist.
///
/// Returns a human-readable log of all warnings and informational messages.
pub fn validate_project(parsed: &ParsedPlugin, masters: &[(String, Vec<u8>)]) -> Result<String> {
    let authored_master_names = parsed.header.masters.clone();
    let provided_master_names: HashSet<_> = masters
        .iter()
        .map(|(name, _)| name.to_ascii_lowercase())
        .collect();

    let mut warnings = Vec::new();
    if masters.is_empty() {
        warnings.push(
            "No master plugins were loaded, so reference validation was skipped.".to_string(),
        );
        return Ok(render_log(&warnings));
    }

    for master_name in authored_master_names {
        if !provided_master_names.contains(&master_name.to_ascii_lowercase()) {
            warnings.push(format!(
                "Master '{master_name}' could not be loaded, so reference validation may be incomplete."
            ));
        }
    }

    let mut database = ValidationDatabase::default();
    for (master_name, bytes) in masters {
        let mut plugin = Plugin::new();
        plugin.load_bytes(bytes.as_ref())?;
        collect_master_ids(&mut database, plugin);
        warnings.push(format!("Loaded master '{master_name}' for validation."));
    }

    for info in &parsed.infos {
        if info.frontmatter.dialogue_type == Some(DialogueType2::Journal) {
            database
                .journal_topics
                .insert(info.topic.to_ascii_lowercase());
        }
    }

    for info in &parsed.infos {
        validate_info(info, &database, &mut warnings);
    }

    Ok(render_log(&warnings))
}

/// Populates the `ValidationDatabase` by indexing relevant IDs and script data
/// from a master plugin.
fn collect_master_ids(database: &mut ValidationDatabase, plugin: Plugin) {
    for object in plugin.objects {
        match object {
            TES3Object::GlobalVariable(record) => {
                database.global_ids.insert(record.id.to_ascii_lowercase());
                database.object_ids.insert(record.id.to_ascii_lowercase());
            }
            TES3Object::Faction(record) => {
                database.faction_ids.insert(record.id.to_ascii_lowercase());
                database.object_ids.insert(record.id.to_ascii_lowercase());
            }
            TES3Object::Race(record) => {
                database.race_ids.insert(record.id.to_ascii_lowercase());
                database.object_ids.insert(record.id.to_ascii_lowercase());
            }
            TES3Object::Class(record) => {
                database.class_ids.insert(record.id.to_ascii_lowercase());
                database.object_ids.insert(record.id.to_ascii_lowercase());
            }
            TES3Object::Npc(record) => {
                database.actor_ids.insert(record.id.to_ascii_lowercase());
                database.object_ids.insert(record.id.to_ascii_lowercase());
                if !record.script.is_empty() {
                    database.actor_scripts.insert(
                        record.id.to_ascii_lowercase(),
                        record.script.to_ascii_lowercase(),
                    );
                }
            }
            TES3Object::Creature(record) => {
                database.actor_ids.insert(record.id.to_ascii_lowercase());
                database.object_ids.insert(record.id.to_ascii_lowercase());
                if !record.script.is_empty() {
                    database.actor_scripts.insert(
                        record.id.to_ascii_lowercase(),
                        record.script.to_ascii_lowercase(),
                    );
                }
            }
            TES3Object::Cell(record) => {
                if !record.name.is_empty() {
                    database.cell_names.insert(record.name.to_ascii_lowercase());
                }
            }
            TES3Object::Dialogue(record) => {
                if record.dialogue_type == DialogueType2::Journal {
                    database
                        .journal_topics
                        .insert(record.id.to_ascii_lowercase());
                }
            }
            TES3Object::Script(record) => {
                let vars = record
                    .variables
                    .split(|&b| b == 0)
                    .filter(|s| !s.is_empty())
                    .map(|s| String::from_utf8_lossy(s).to_ascii_lowercase())
                    .collect();
                database
                    .script_variables
                    .insert(record.id.to_ascii_lowercase(), vars);
                database.object_ids.insert(record.id.to_ascii_lowercase());
            }
            other => {
                if let Some(id) = object_id(&other) {
                    database.object_ids.insert(id.to_ascii_lowercase());
                }
            }
        }
    }
}

/// Helper to extract the primary ID string from most TES3 object types.
fn object_id(object: &TES3Object) -> Option<&str> {
    match object {
        TES3Object::GameSetting(record) => Some(&record.id),
        TES3Object::Sound(record) => Some(&record.id),
        TES3Object::SoundGen(record) => Some(&record.id),
        TES3Object::Script(record) => Some(&record.id),
        TES3Object::Region(record) => Some(&record.id),
        TES3Object::Birthsign(record) => Some(&record.id),
        TES3Object::StartScript(record) => Some(&record.id),
        TES3Object::LandscapeTexture(record) => Some(&record.id),
        TES3Object::Spell(record) => Some(&record.id),
        TES3Object::Static(record) => Some(&record.id),
        TES3Object::Door(record) => Some(&record.id),
        TES3Object::MiscItem(record) => Some(&record.id),
        TES3Object::Weapon(record) => Some(&record.id),
        TES3Object::Container(record) => Some(&record.id),
        TES3Object::Bodypart(record) => Some(&record.id),
        TES3Object::Light(record) => Some(&record.id),
        TES3Object::Enchanting(record) => Some(&record.id),
        TES3Object::Armor(record) => Some(&record.id),
        TES3Object::Clothing(record) => Some(&record.id),
        TES3Object::RepairItem(record) => Some(&record.id),
        TES3Object::Activator(record) => Some(&record.id),
        TES3Object::Apparatus(record) => Some(&record.id),
        TES3Object::Lockpick(record) => Some(&record.id),
        TES3Object::Probe(record) => Some(&record.id),
        TES3Object::Ingredient(record) => Some(&record.id),
        TES3Object::Book(record) => Some(&record.id),
        TES3Object::Alchemy(record) => Some(&record.id),
        TES3Object::LeveledItem(record) => Some(&record.id),
        TES3Object::LeveledCreature(record) => Some(&record.id),
        _ => None,
    }
}

/// Performs all validation checks for a single `DialogueInfo` entry.
fn validate_info(info: &ParsedInfo, database: &ValidationDatabase, warnings: &mut Vec<String>) {
    warn_if_missing(
        info,
        "ID",
        info.frontmatter.speaker_id.as_deref(),
        &database.actor_ids,
        Some("Use an NPC or creature record ID from the loaded masters."),
        warnings,
    );
    warn_if_missing(
        info,
        "Race",
        info.frontmatter.speaker_race.as_deref(),
        &database.race_ids,
        Some("Use the race ID from the loaded masters, not a display name guess."),
        warnings,
    );
    warn_if_missing(
        info,
        "Class",
        info.frontmatter.speaker_class.as_deref(),
        &database.class_ids,
        Some("Use the class ID from the loaded masters."),
        warnings,
    );
    warn_if_missing(
        info,
        "Faction",
        info.frontmatter.speaker_faction.as_deref(),
        &database.faction_ids,
        Some("Use the faction ID from the loaded masters, not the faction display name."),
        warnings,
    );
    warn_if_missing(
        info,
        "Cell",
        info.frontmatter.speaker_cell.as_deref(),
        &database.cell_names,
        Some("Use the exact cell name from the loaded masters."),
        warnings,
    );
    warn_if_missing(
        info,
        "PC Faction",
        info.frontmatter.player_faction.as_deref(),
        &database.faction_ids,
        Some("Use the faction ID from the loaded masters."),
        warnings,
    );

    for filter in &info.frontmatter.filters {
        validate_filter(info, filter, database, warnings);
    }
}

/// Validates a single dialogue filter's referenced ID against the appropriate
/// lookup table for its filter type. `Local`/`NotLocal` filters get deeper
/// treatment: the variable must exist on the script attached to the speaker.
fn validate_filter(
    info: &ParsedInfo,
    filter: &ParsedFilter,
    database: &ValidationDatabase,
    warnings: &mut Vec<String>,
) {
    let filter_label = format!("Variable{}", filter.index);

    match filter.filter_type {
        FilterType::Global => warn_if_missing(
            info,
            &filter_label,
            Some(filter.id.as_str()),
            &database.global_ids,
            Some("The referenced global was not found in the loaded masters."),
            warnings,
        ),
        FilterType::Journal => warn_if_missing(
            info,
            &filter_label,
            Some(filter.id.as_str()),
            &database.journal_topics,
            Some(
                "The referenced journal topic was not found in the loaded masters or this project.",
            ),
            warnings,
        ),
        FilterType::Item => warn_if_missing(
            info,
            &filter_label,
            Some(filter.id.as_str()),
            &database.object_ids,
            Some("The referenced item or object ID was not found in the loaded masters."),
            warnings,
        ),
        FilterType::Dead | FilterType::NotId => warn_if_missing(
            info,
            &filter_label,
            Some(filter.id.as_str()),
            &database.actor_ids,
            Some("The referenced NPC or creature ID was not found in the loaded masters."),
            warnings,
        ),
        FilterType::NotFaction => warn_if_missing(
            info,
            &filter_label,
            Some(filter.id.as_str()),
            &database.faction_ids,
            Some("The referenced faction ID was not found in the loaded masters."),
            warnings,
        ),
        FilterType::NotClass => warn_if_missing(
            info,
            &filter_label,
            Some(filter.id.as_str()),
            &database.class_ids,
            Some("The referenced class ID was not found in the loaded masters."),
            warnings,
        ),
        FilterType::NotRace => warn_if_missing(
            info,
            &filter_label,
            Some(filter.id.as_str()),
            &database.race_ids,
            Some("The referenced race ID was not found in the loaded masters."),
            warnings,
        ),
        FilterType::NotCell => warn_if_missing(
            info,
            &filter_label,
            Some(filter.id.as_str()),
            &database.cell_names,
            Some("The referenced cell name was not found in the loaded masters."),
            warnings,
        ),
        FilterType::Local | FilterType::NotLocal => {
            if let Some(speaker_id) = info.frontmatter.speaker_id.as_deref() {
                if let Some(script_id) =
                    database.actor_scripts.get(&speaker_id.to_ascii_lowercase())
                {
                    if let Some(variables) = database.script_variables.get(script_id) {
                        if !variables.contains(&filter.id.to_ascii_lowercase()) {
                            warnings.push(format!(
                                "{}: {} uses local variable '{}', but it was not found on script '{}' attached to speaker '{}'.",
                                info.source_path, filter_label, filter.id, script_id, speaker_id
                            ));
                        }
                    } else {
                        warnings.push(format!(
                            "{}: {} uses local variable '{}', but script '{}' (on speaker '{}') was not found in masters.",
                            info.source_path, filter_label, filter.id, script_id, speaker_id
                        ));
                    }
                } else {
                    warnings.push(format!(
                        "{}: {} uses local variable '{}', but speaker '{}' has no script attached.",
                        info.source_path, filter_label, filter.id, speaker_id
                    ));
                }
            } else {
                // If there's no speaker ID, we can't reliably validate the local variable without more context.
                // However, most dialogue with local filters has a speaker, and we should at least warn
                // that validation was skipped for this reason if the user expects it.
                // For now, let's keep the existing warning or a more specific one.
                warnings.push(format!(
                    "{}: {} uses local variable '{}', but no speaker ID is defined to validate against.",
                    info.source_path, filter_label, filter.id
                ));
            }
        }
        FilterType::Function | FilterType::None => {}
    }
}

/// Reports a warning if the specified value is not found in the set of `known_ids`.
fn warn_if_missing(
    info: &ParsedInfo,
    field_name: &str,
    value: Option<&str>,
    known_ids: &HashSet<String>,
    hint: Option<&str>,
    warnings: &mut Vec<String>,
) {
    let Some(value) = value else {
        return;
    };

    let trimmed = value.trim();
    if trimmed.is_empty() || known_ids.contains(&trimmed.to_ascii_lowercase()) {
        return;
    }

    let mut message = format!(
        "{}: {} '{}' was not found in the loaded masters.",
        info.source_path, field_name, trimmed
    );
    if let Some(hint) = hint {
        message.push(' ');
        message.push_str(hint);
    }
    warnings.push(message);
}

/// Formats collected warnings into the final compile-log text shown to users.
fn render_log(warnings: &[String]) -> String {
    let mut output = String::from("obsidian_esp compile log\n");

    if warnings.is_empty() {
        output.push_str("\nNo issues found.\n");
        return output;
    }

    output.push_str("\nMessages:\n");
    for warning in warnings {
        output.push_str("- ");
        output.push_str(warning);
        output.push('\n');
    }

    output
}
