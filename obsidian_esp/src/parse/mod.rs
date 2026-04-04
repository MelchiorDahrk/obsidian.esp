use anyhow::{Context, Result};
use std::path::Path;
use tes3::esp::{DialogueType2, FilterComparison, FilterType};

pub mod frontmatter;
pub mod header;
pub mod info;

#[derive(Debug)]
pub struct ParsedPlugin {
    pub header: ParsedHeader,
    pub infos: Vec<ParsedInfo>,
}

#[derive(Debug)]
pub struct ParsedHeader {
    pub author: String,
    pub description: String,
    pub file_type: String,
    pub masters: Vec<String>,
}

#[derive(Debug, Default)]
pub struct ParsedInfo {
    pub topic: String,
    pub frontmatter: ParsedInfoFrontmatter,
    pub text: String,
}

#[derive(Debug, Default)]
pub struct ParsedInfoFrontmatter {
    pub topic_override: Option<String>,
    pub dialogue_type: Option<DialogueType2>,
    pub diag_id: Option<String>,
    pub prev_id: Option<String>,
    pub speaker_id: Option<String>,
    pub disposition: Option<i32>,
    pub speaker_race: Option<String>,
    pub speaker_sex: Option<i32>,
    pub speaker_class: Option<String>,
    pub speaker_faction: Option<String>,
    pub speaker_rank: Option<i8>,
    pub speaker_cell: Option<String>,
    pub player_faction: Option<String>,
    pub player_rank: Option<i8>,
    pub sound_path: Option<String>,
    pub script_text: Option<String>,
    pub quest_state: Option<String>, // "Name", "Finished", "Restart"
    pub filters: Vec<ParsedFilter>,
}

#[derive(Debug)]
pub struct ParsedFilter {
    pub index: u8,
    pub filter_type: FilterType,
    pub function_name: Option<String>,
    pub comparison: FilterComparison,
    pub id: String,
    pub value: FilterValue,
}

#[derive(Debug)]
pub enum FilterValue {
    Float(f32),
    Integer(i32),
}

fn parse_type_directory_name(name: &str) -> Option<DialogueType2> {
    if name.eq_ignore_ascii_case("Topic") {
        Some(DialogueType2::Topic)
    } else if name.eq_ignore_ascii_case("Journal") {
        Some(DialogueType2::Journal)
    } else if name.eq_ignore_ascii_case("Voice") {
        Some(DialogueType2::Voice)
    } else if name.eq_ignore_ascii_case("Greeting") {
        Some(DialogueType2::Greeting)
    } else if name.eq_ignore_ascii_case("Persuasion") {
        Some(DialogueType2::Persuasion)
    } else {
        None
    }
}

fn dialogue_type_priority(dialogue_type: DialogueType2) -> u8 {
    match dialogue_type {
        DialogueType2::Journal => 0,
        DialogueType2::Topic => 1,
        DialogueType2::Voice => 2,
        DialogueType2::Greeting => 3,
        DialogueType2::Persuasion => 4,
    }
}

pub fn parse_project_directory(path: &Path) -> Result<ParsedPlugin> {
    let mut header = None;

    // Collect (type, topic, order, path) for info files so we can sort them.
    let mut info_entries: Vec<(DialogueType2, String, u64, std::path::PathBuf)> = Vec::new();

    let entries = std::fs::read_dir(path)
        .with_context(|| format!("Failed to read directory: {}", path.display()))?;

    for entry in entries {
        let entry = entry?;
        let entry_path = entry.path();

        if entry.file_type()?.is_file() {
            if entry_path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }

            let file_name = entry_path
                .file_stem()
                .unwrap()
                .to_string_lossy()
                .into_owned();

            if file_name.eq_ignore_ascii_case("header") {
                let content = std::fs::read_to_string(&entry_path)
                    .with_context(|| format!("Failed to read file: {}", entry_path.display()))?;
                let mut input = content.as_str();
                header = Some(
                    header::parse_header(&mut input)
                        .map_err(|e| anyhow::anyhow!("{}", e))
                        .with_context(|| "Failed to parse header.md")?,
                );
            }

            continue;
        }

        let type_dir_name = entry.file_name().to_string_lossy().into_owned();
        let dialogue_type = parse_type_directory_name(&type_dir_name).with_context(|| {
            format!(
                "Unexpected top-level directory '{}'; expected one of Topic, Journal, Voice, Greeting, or Persuasion",
                entry_path.display()
            )
        })?;

        let topic_dirs = std::fs::read_dir(&entry_path)
            .with_context(|| format!("Failed to read directory: {}", entry_path.display()))?;

        for topic_dir in topic_dirs {
            let topic_dir = topic_dir?;
            if !topic_dir.file_type()?.is_dir() {
                continue;
            }

            let topic_name = topic_dir.file_name().to_string_lossy().into_owned();
            let topic_path = topic_dir.path();
            let files = std::fs::read_dir(&topic_path)
                .with_context(|| format!("Failed to read directory: {}", topic_path.display()))?;

            for file in files {
                let file = file?;
                if !file.file_type()?.is_file() {
                    continue;
                }

                let file_path = file.path();
                if file_path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }

                let file_name = file_path
                    .file_stem()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned();

                // Extract the numeric order from the `~N` suffix: "TopicId ~N"
                // The suffix is always ` ~<number>` at the end of the stem.
                let order: u64 = if let Some(idx) = file_name.rfind(" ~") {
                    file_name[idx + 2..].parse().unwrap_or(u64::MAX)
                } else {
                    u64::MAX
                };

                info_entries.push((dialogue_type, topic_name.clone(), order, file_path));
            }
        }
    }

    // Sort topic files by type, topic, then numeric suffix so infos are inserted
    // in the correct sequence even when no explicit PrevID is specified.
    info_entries.sort_by(|left, right| {
        dialogue_type_priority(left.0)
            .cmp(&dialogue_type_priority(right.0))
            .then_with(|| left.1.to_ascii_lowercase().cmp(&right.1.to_ascii_lowercase()))
            .then_with(|| left.2.cmp(&right.2))
    });

    let mut infos = Vec::new();
    for (directory_type, directory_topic, _order, entry_path) in info_entries {
        let content = std::fs::read_to_string(&entry_path)
            .with_context(|| format!("Failed to read file: {}", entry_path.display()))?;
        let mut input = content.as_str();

        let (mut frontmatter, text) = info::parse_info_file(&mut input)
            .map_err(|e| anyhow::anyhow!("{}", e))
            .with_context(|| format!("Failed to parse info file: {}", entry_path.display()))?;

        if let Some(frontmatter_type) = frontmatter.dialogue_type {
            anyhow::ensure!(
                frontmatter_type == directory_type,
                "Dialogue type in {} does not match parent folder '{}'",
                entry_path.display(),
                match directory_type {
                    DialogueType2::Topic => "Topic",
                    DialogueType2::Journal => "Journal",
                    DialogueType2::Voice => "Voice",
                    DialogueType2::Greeting => "Greeting",
                    DialogueType2::Persuasion => "Persuasion",
                }
            );
        } else {
            frontmatter.dialogue_type = Some(directory_type);
        }

        let topic = frontmatter
            .topic_override
            .clone()
            .unwrap_or(directory_topic);

        infos.push(ParsedInfo {
            topic,
            frontmatter,
            text,
        });
    }

    let header = header.context("Missing header.md")?;

    Ok(ParsedPlugin { header, infos })
}
