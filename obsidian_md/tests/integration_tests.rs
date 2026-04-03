use anyhow::Result;
use itertools::Itertools;
use merge_to_master::PluginData;
use obsidian_md::collect_master_paths;
use std::fs;
use std::iter::zip;
use std::path::Path;
use uncased::AsUncased;

fn assert_infos_match_ignoring_next_id(
    expected_infos: &std::collections::VecDeque<tes3::esp::DialogueInfo>,
    actual_infos: &std::collections::VecDeque<tes3::esp::DialogueInfo>,
) {
    assert_eq!(expected_infos.len(), actual_infos.len());

    for (expected_info, actual_info) in zip(expected_infos, actual_infos) {
        assert_eq!(expected_info.flags, actual_info.flags);
        assert_eq!(expected_info.id, actual_info.id);
        assert_eq!(expected_info.prev_id, actual_info.prev_id);
        assert_eq!(expected_info.data, actual_info.data);
        assert_eq!(expected_info.speaker_id, actual_info.speaker_id);
        assert_eq!(expected_info.speaker_race, actual_info.speaker_race);
        assert_eq!(expected_info.speaker_class, actual_info.speaker_class);
        assert_eq!(expected_info.speaker_faction, actual_info.speaker_faction);
        assert_eq!(expected_info.speaker_cell, actual_info.speaker_cell);
        assert_eq!(expected_info.player_faction, actual_info.player_faction);
        assert_eq!(expected_info.sound_path, actual_info.sound_path);
        assert_eq!(expected_info.text, actual_info.text);
        assert_eq!(expected_info.quest_state, actual_info.quest_state);
        assert_eq!(expected_info.filters, actual_info.filters);
        assert_eq!(expected_info.script_text, actual_info.script_text);
    }
}

#[test]
fn test_topics_1() -> Result<()> {
    let markdown_path = Path::new("tests/test_topics_1/project");
    let expected_path = Path::new("tests/test_topics_1/expect/output.esp");

    let parsed = obsidian_md::parse::parse_project_directory(&markdown_path)?;
    let (master_paths, master_sizes) = collect_master_paths(&parsed.header.masters);

    let compiled = obsidian_md::compile::compile(parsed)?;
    let resolved = obsidian_md::compile::resolve::resolve(compiled, &master_paths, master_sizes)?;
    let expected = PluginData::from_path(&expected_path)?;

    assert_eq!(resolved.dialogues.len(), expected.dialogues.len());

    let resolved_groups = resolved
        .dialogues
        .values()
        .sorted_by_key(|g| g.dialogue.id.as_uncased())
        .collect_vec();

    let expected_groups = expected
        .dialogues
        .values()
        .sorted_by_key(|g| g.dialogue.id.as_uncased())
        .collect_vec();

    for (resolved_group, expected_group) in zip(&resolved_groups, &expected_groups) {
        let expected_dialogue = &expected_group.dialogue;
        let resolved_dialogue = &resolved_group.dialogue;

        // Test `Dialogue` fields.

        assert_eq!(expected_dialogue.flags, resolved_dialogue.flags);
        assert_eq!(
            resolved_dialogue.id.as_uncased(),
            expected_dialogue.id.as_uncased()
        );
        assert_eq!(
            expected_dialogue.dialogue_type,
            resolved_dialogue.dialogue_type
        );

        // Test `DialogueInfo` fields.

        // Note: Don't compare `id` fields directly since they are generated randomly.
        // Instead, compare the structure and content of the dialogue infos.

        let expected_infos = &expected_group.infos;
        let resolved_infos = &resolved_group.infos;

        assert_eq!(
            expected_infos.len(),
            resolved_infos.len(),
            "group {}",
            expected_group.dialogue.id
        );

        for (expected_info, resolved_info) in zip(expected_infos, resolved_infos) {
            assert_eq!(expected_info.flags, resolved_info.flags);
            assert_eq!(
                expected_info.speaker_id.as_uncased(),
                resolved_info.speaker_id.as_uncased()
            );
            assert_eq!(
                expected_info.speaker_id.as_uncased(),
                resolved_info.speaker_id.as_uncased()
            );
            assert_eq!(expected_info.data, resolved_info.data);
            assert_eq!(
                expected_info.speaker_id.as_uncased(),
                resolved_info.speaker_id.as_uncased()
            );
            assert_eq!(
                expected_info.speaker_race.as_uncased(),
                resolved_info.speaker_race.as_uncased()
            );
            assert_eq!(
                expected_info.speaker_class.as_uncased(),
                resolved_info.speaker_class.as_uncased()
            );
            assert_eq!(
                expected_info.speaker_faction.as_uncased(),
                resolved_info.speaker_faction.as_uncased()
            );
            assert_eq!(
                expected_info.speaker_cell.as_uncased(),
                resolved_info.speaker_cell.as_uncased()
            );
            assert_eq!(
                expected_info.player_faction.as_uncased(),
                resolved_info.player_faction.as_uncased()
            );
            assert_eq!(
                expected_info.sound_path.as_uncased(),
                resolved_info.sound_path.as_uncased()
            );
            assert_eq!(expected_info.text, resolved_info.text);
            assert_eq!(expected_info.quest_state, resolved_info.quest_state);
            assert_eq!(expected_info.filters, resolved_info.filters);
            assert_eq!(expected_info.script_text, resolved_info.script_text);
        }
    }

    Ok(())
}

#[test]
fn test_export_round_trip() -> Result<()> {
    let expected_path = Path::new("tests/test_topics_1/expect/output.esp");
    let export_path = Path::new("tests/test_topics_1/generated");

    if export_path.exists() {
        fs::remove_dir_all(export_path)?;
    }
    fs::create_dir_all(export_path)?;

    let expected = PluginData::from_path(expected_path)?;
    obsidian_md::export::write_project_directory(&expected, export_path)?;

    let reparsed = obsidian_md::parse::parse_project_directory(export_path)?;
    assert_eq!(
        reparsed.header.masters,
        expected
            .header
            .masters
            .iter()
            .map(|(name, _)| name.clone())
            .collect_vec()
    );

    let recompiled = obsidian_md::compile::compile(reparsed)?;

    assert_eq!(recompiled.header.author, expected.header.author);
    assert_eq!(recompiled.header.description, expected.header.description);
    assert_eq!(recompiled.header.file_type, expected.header.file_type);
    assert_eq!(recompiled.dialogues.len(), expected.dialogues.len());

    let recompiled_groups = recompiled
        .dialogues
        .values()
        .sorted_by_key(|g| g.dialogue.id.as_uncased())
        .collect_vec();

    let expected_groups = expected
        .dialogues
        .values()
        .sorted_by_key(|g| g.dialogue.id.as_uncased())
        .collect_vec();

    for (recompiled_group, expected_group) in zip(&recompiled_groups, &expected_groups) {
        assert_eq!(recompiled_group.dialogue, expected_group.dialogue);
        assert_infos_match_ignoring_next_id(&expected_group.infos, &recompiled_group.infos);
    }

    Ok(())
}
