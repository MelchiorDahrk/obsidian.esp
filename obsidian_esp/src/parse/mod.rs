use anyhow::{Context, Result};
use std::path::Path;
use tes3::esp::{DialogueType2, FilterComparison, FilterType};

pub mod frontmatter;
pub mod header;
pub mod info;

/// The internal representation of a full project parsed from Markdown files.
#[derive(Debug)]
pub struct ParsedPlugin {
    pub header: ParsedHeader,
    pub infos: Vec<ParsedInfo>,
}

/// Data parsed from the project's `header.md` or `header.yaml`.
#[derive(Debug)]
pub struct ParsedHeader {
    pub author: String,
    pub description: String,
    pub file_type: String,
    pub masters: Vec<String>,
}

/// Data parsed from an individual dialogue Markdown file.
#[derive(Debug, Default)]
pub struct ParsedInfo {
    pub source_path: String,
    pub topic: String,
    pub frontmatter: ParsedInfoFrontmatter,
    pub text: String,
}

/// YAML frontmatter content for an individual dialogue response.
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

/// Returns the sort order index from a filename (e.g., `Topic ~5.md` -> 5).
/// 
/// This index is used to maintain evaluation order when `PrevID` links are not 
/// explicitly provided.
fn default_sort_order(file_name: &str) -> u64 {
    if let Some(idx) = file_name.rfind(" ~") {
        file_name[idx + 2..].parse().unwrap_or(u64::MAX)
    } else {
        u64::MAX
    }
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

fn parse_header_content(content: &str) -> Result<ParsedHeader> {
    let mut input = content;
    header::parse_header(&mut input)
        .map_err(|e| anyhow::anyhow!("{}", e))
        .with_context(|| "Failed to parse header.md")
}

/// Parses a set of file contents into a `ParsedPlugin`.
/// 
/// `files` is a list of `(relative_path, content)` pairs. This handles normalizing 
/// paths and sorting files based on the project's directory structure conventions.
pub fn parse_project_files(
    files: Vec<(String, String)>,
    default_header: Option<ParsedHeader>,
) -> Result<ParsedPlugin> {
    let mut header = None;

    // Collect (type, topic, order, path, content) for info files so we can sort them.
    let mut info_entries: Vec<(DialogueType2, String, u64, String, String)> = Vec::new();

    for (relative_path, content) in files {
        let normalized_path = relative_path.replace('\\', "/");
        let parts = normalized_path.split('/').collect::<Vec<_>>();

        if parts.len() == 1 {
            if parts[0].eq_ignore_ascii_case("header.md") {
                header = Some(parse_header_content(&content)?);
            }
            continue;
        }

        if parts.len() != 3 {
            continue;
        }

        let Some(dialogue_type) = parse_type_directory_name(parts[0]) else {
            continue;
        };

        let file_name = parts[2];
        if !file_name.ends_with(".md") {
            continue;
        }

        let topic_name = parts[1].to_string();
        let file_stem = Path::new(file_name)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(file_name);
        let order = default_sort_order(file_stem);

        info_entries.push((
            dialogue_type,
            topic_name,
            order,
            normalized_path,
            content,
        ));
    }

    info_entries.sort_by(|left, right| {
        dialogue_type_priority(left.0)
            .cmp(&dialogue_type_priority(right.0))
            .then_with(|| left.1.to_ascii_lowercase().cmp(&right.1.to_ascii_lowercase()))
            .then_with(|| left.2.cmp(&right.2))
    });

    let mut infos = Vec::new();
    for (directory_type, directory_topic, _order, relative_path, content) in info_entries {
        let mut input = content.as_str();
        if !input.trim_start().starts_with("---") {
            continue;
        }

        let (mut frontmatter, text) = info::parse_info_file(&mut input)
            .map_err(|e| anyhow::anyhow!("{}", e))
            .with_context(|| format!("Failed to parse info file: {relative_path}"))?;

        if let Some(frontmatter_type) = frontmatter.dialogue_type {
            anyhow::ensure!(
                frontmatter_type == directory_type,
                "Dialogue type in {} does not match parent folder '{}'",
                relative_path,
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
            source_path: relative_path,
            topic,
            frontmatter,
            text,
        });
    }

    let header = header
        .or(default_header)
        .context("Missing header.md")?;

    Ok(ParsedPlugin { header, infos })
}

/// Reads all Markdown files in a project directory and parses them into a `ParsedPlugin`.
pub fn parse_project_directory(path: &Path) -> Result<ParsedPlugin> {
    let files = collect_project_files_from_disk(path)?;
    parse_project_files(files, None)
}

/// Discovers and reads all valid project Markdown files from the local filesystem.
///
/// This includes the top-level `header.md` and all dialogue files within the 
/// expected directory hierarchy: `{TypeDir}/{TopicDir}/{File.md}`.
fn collect_project_files_from_disk(path: &Path) -> Result<Vec<(String, String)>> {
    let mut files = Vec::new();

    let entries = std::fs::read_dir(path)
        .with_context(|| format!("Failed to read directory: {}", path.display()))?;

    for entry in entries {
        let entry = entry?;
        let entry_path = entry.path();

        if entry.path().is_file() {
            if entry_path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }

            let content = std::fs::read_to_string(&entry_path)
                .with_context(|| format!("Failed to read file: {}", entry_path.display()))?;
            let relative_path = entry_path
                .strip_prefix(path)
                .with_context(|| format!("Failed to normalize path: {}", entry_path.display()))?
                .to_string_lossy()
                .into_owned();
            files.push((relative_path, content));
            continue;
        }

        let type_dir_name = entry.file_name().to_string_lossy().into_owned();
        parse_type_directory_name(&type_dir_name).with_context(|| {
            format!(
                "Unexpected top-level directory '{}'; expected one of Topic, Journal, Voice, Greeting, or Persuasion",
                entry_path.display()
            )
        })?;

        let topic_dirs = std::fs::read_dir(&entry_path)
            .with_context(|| format!("Failed to read directory: {}", entry_path.display()))?;

        for topic_dir in topic_dirs {
            let topic_dir = topic_dir?;
            if !topic_dir.path().is_dir() {
                continue;
            }

            let topic_path = topic_dir.path();
            let topic_files = std::fs::read_dir(&topic_path)
                .with_context(|| format!("Failed to read directory: {}", topic_path.display()))?;

            for file in topic_files {
                let file = file?;
                if !file.path().is_file() {
                    continue;
                }

                let file_path = file.path();
                if file_path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }

                let content = std::fs::read_to_string(&file_path)
                    .with_context(|| format!("Failed to read file: {}", file_path.display()))?;
                let relative_path = file_path
                    .strip_prefix(path)
                    .with_context(|| format!("Failed to normalize path: {}", file_path.display()))?
                    .to_string_lossy()
                    .into_owned();
                files.push((relative_path, content));
            }
        }
    }
    
    Ok(files)
}
