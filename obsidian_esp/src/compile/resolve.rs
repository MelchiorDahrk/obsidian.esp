//! Resolution: merges a compiled plugin with its master files and diffs the
//! result.
//!
//! Merging masters and plugin into one dataset has a side effect: inserting a
//! response into an existing topic rewrites the prev/next link pointers of
//! neighboring *master* records. Shipping those as edits would bloat the
//! plugin and create false conflicts, so this module snapshots every master
//! info before the merge (`create_link_snapshots`) and afterwards classifies
//! each change as **semantic** (content differs) or **link-only** (only the
//! pointers moved). Two entry points share that machinery:
//!
//! - [`resolve`] — native path: prunes everything unmodified and returns a
//!   minimal `PluginData` ready to save as an `.esp`.
//! - [`resolve_full_database`] — WASM path: keeps the entire merged database
//!   in memory (for the Obsidian plugin's `GameDatabase`) and returns the
//!   link-only change list alongside it.

use anyhow::Result;
use merge_to_master::traits::MergeInto;
use merge_to_master::{DialogueGroup, Exterior, Interior, PluginData, merge_load_order};
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::PathBuf;
use tes3::esp::{DialogueData, DialogueType2, Filter, ObjectFlags, ObjectInfo, QuestState};

/// A value snapshot of every *semantic* field of a `DialogueInfo` — i.e.
/// everything except the `prev_id`/`next_id` link pointers and record ID.
///
/// Comparing snapshots taken before and after a merge tells us whether a
/// record's content actually changed or only its position in the linked list.
#[derive(Clone, PartialEq)]
struct InfoSnapshot {
    flags: ObjectFlags,
    data: DialogueData,
    speaker_id: String,
    speaker_race: String,
    speaker_class: String,
    speaker_faction: String,
    speaker_cell: String,
    player_faction: String,
    sound_path: String,
    text: String,
    quest_state: Option<QuestState>,
    filters: Vec<Filter>,
    script_text: String,
}

impl From<&tes3::esp::DialogueInfo> for InfoSnapshot {
    fn from(info: &tes3::esp::DialogueInfo) -> Self {
        Self {
            flags: info.flags,
            data: info.data.clone(),
            speaker_id: info.speaker_id.clone(),
            speaker_race: info.speaker_race.clone(),
            speaker_class: info.speaker_class.clone(),
            speaker_faction: info.speaker_faction.clone(),
            speaker_cell: info.speaker_cell.clone(),
            player_faction: info.player_faction.clone(),
            sound_path: info.sound_path.clone(),
            text: info.text.clone(),
            quest_state: info.quest_state.clone(),
            filters: info.filters.clone(),
            script_text: info.script_text.clone(),
        }
    }
}

/// Per-topic map of info ID -> `(prev_id, next_id, content snapshot)` captured
/// before merging. Outer key is the dialogue (topic) ID.
type LinkSnapshots = HashMap<String, HashMap<String, (String, String, InfoSnapshot)>>;

/// Captures the current link pointers (prev/next) and a semantic content snapshot for all
/// dialogue infos in the provided dataset.
///
/// This provides a baseline used to detect which records have changed during a merge
/// and specifically whether those changes are "semantic" (content changes) or merely
/// "structural" (link-pointer updates due to list re-ordering).
fn create_link_snapshots(data: &PluginData) -> LinkSnapshots {
    data.dialogues
        .values()
        .map(|dialogue| {
            let key = dialogue.dialogue.id.clone();
            let snapshot: HashMap<_, _> = dialogue
                .infos
                .iter()
                .map(|info| {
                    let info_id = info.id.clone();
                    let prev_id = info.prev_id.clone();
                    let next_id = info.next_id.clone();
                    let content = InfoSnapshot::from(info);
                    (info_id, (prev_id, next_id, content))
                })
                .collect();
            (key, snapshot)
        })
        .collect()
}

/// A trait for removing records that haven't been modified from a container.
///
/// This is used during the resolution pass to prune master records that were
/// loaded only for context and haven't actually been changed by the plugin.
pub trait RemoveUnmodified {
    fn remove_unmodified(&mut self);
}

impl<T> RemoveUnmodified for Option<T>
where
    T: ObjectInfo,
{
    fn remove_unmodified(&mut self) {
        if let Some(x) = self {
            if !x.modified() {
                self.take();
            }
        }
    }
}

impl RemoveUnmodified for Exterior {
    fn remove_unmodified(&mut self) {
        self.cell.remove_unmodified();
        self.landscape.remove_unmodified();
        self.pathgrid.remove_unmodified();
    }
}

impl RemoveUnmodified for Interior {
    fn remove_unmodified(&mut self) {
        self.cell.remove_unmodified();
        self.pathgrid.remove_unmodified();
    }
}

impl RemoveUnmodified for DialogueGroup {
    fn remove_unmodified(&mut self) {
        self.infos.retain(|info| info.modified());
    }
}

impl RemoveUnmodified for PluginData {
    fn remove_unmodified(&mut self) {
        self.objects.retain(|_, object| object.modified());
        self.cells.exteriors.retain(|_, exterior| {
            exterior.remove_unmodified();
            exterior.cell.is_some() || exterior.landscape.is_some() || exterior.pathgrid.is_some()
        });
        self.cells.interiors.retain(|_, interior| {
            interior.remove_unmodified();
            interior.cell.is_some() || interior.pathgrid.is_some()
        });
        self.dialogues.retain(|_, group| {
            group.remove_unmodified();
            group.dialogue.modified() || !group.infos.is_empty()
        });
    }
}

/// Resolves an authored plugin against its master files.
///
/// 1. Merges masters into a single baseline.
/// 2. Merges the authored plugin into that baseline.
/// 3. Detects semantic changes in dialogue (beyond simple link updates).
/// 4. Prunes everything that wasn't modified.
///
/// Returns a `PluginData` containing only the modified records, ready for saving as an ESP.
pub fn resolve(
    mut plugin: PluginData,
    master_paths: &[PathBuf],
    original_masters: Vec<(String, u64)>,
) -> Result<PluginData> {
    let touched_journal_topics: HashSet<_> = plugin
        .dialogues
        .iter()
        .filter(|(_, group)| group.dialogue.dialogue_type == DialogueType2::Journal)
        .map(|(topic_id, _)| topic_id.clone())
        .collect();

    // 1. Merge load order to get masters
    let mut master_data = merge_load_order(master_paths)?;

    // 2. Set modified=false on masters
    master_data.set_all_modified(false);

    // 3. Set modified=true on plugin content
    plugin.set_all_modified(true);

    // 4. Snapshot the master dialogue infos *before* merging so we can detect
    //    which infos changed. We record both the link pointers (prev/next) and a
    //    lightweight content snapshot that excludes the link fields. Later we will
    //    treat pure link-pointer updates as non-semantic and not mark those infos
    //    as modified for pruning/export.
    let link_snapshots = create_link_snapshots(&master_data);

    // 5. Merge our plugin into masters (also calls repair_links inside)
    plugin.merge_into(&mut master_data);

    // 6. Journal groups are ordered by journal index in practice; normalize them here so
    //    authored additions to existing quests slot into the expected stage order.
    for (topic_id, group) in master_data.dialogues.iter_mut() {
        if touched_journal_topics.contains(topic_id)
            && group.dialogue.dialogue_type == DialogueType2::Journal
        {
            group
                .infos
                .make_contiguous()
                .sort_by_key(|info| info.data.disposition);
            group.repair_links();
        }
    }

    // 7. Mark any master info whose links changed as modified so it survives pruning.
    for group in master_data.dialogues.values_mut() {
        let Some(snapshots) = link_snapshots.get(&group.dialogue.id) else {
            continue;
        };
        for info in group.infos.iter_mut().skip_while(|info| info.modified()) {
            if let Some((old_prev, old_next, _old_content)) = snapshots.get(&info.id) {
                if info.prev_id != *old_prev || info.next_id != *old_next {
                    info.set_modified(true);
                }
            }
        }
    }

    // 8. Prune unmodified
    master_data.remove_unmodified();
    master_data.set_all_modified(false);

    // 9. Restore original masters list
    master_data.header.masters = original_masters;

    // The previous file type might have been ESM, so switch back to ESP
    master_data.header.file_type = tes3::esp::FileType::Esp;
    // Num objects is calculated dynamically on save, so we can ignore it
    master_data.header.num_objects = 0;

    Ok(master_data)
}

/// Like `resolve`, but keeps the full merged database in memory (no pruning).
/// Master data is passed as in-memory `PluginData` (for WASM where we have bytes, not paths).
/// The `modified` flag is preserved so callers can distinguish plugin content from master content.
pub fn resolve_full_database(
    mut plugin: PluginData,
    masters: Vec<PluginData>,
    original_masters: Vec<(String, u64)>,
) -> Result<(PluginData, Vec<(String, String)>)> {
    let touched_journal_topics: HashSet<_> = plugin
        .dialogues
        .iter()
        .filter(|(_, group)| group.dialogue.dialogue_type == DialogueType2::Journal)
        .map(|(topic_id, _)| topic_id.clone())
        .collect();

    // 1. Fold masters into a single merged dataset.
    // Take the first master directly to avoid a redundant O(K²) re-insertion pass
    // through all dialogue groups (merge_into uses a HashMap index with O(N)-per-insert
    // position updates, making re-merging into an empty PluginData much slower than the
    // original from_plugin parse). Additional masters are still merged in normally.
    let mut masters_iter = masters.into_iter();
    let mut master_data = masters_iter.next().unwrap_or_default();
    for m in masters_iter {
        m.merge_into(&mut master_data);
    }

    // 2. Set modified=false on masters
    master_data.set_all_modified(false);

    // 3. Set modified=true on plugin content
    plugin.set_all_modified(true);

    // 4. Snapshot the master dialogue infos *before* merging so we can detect
    //    link-only changes vs content changes (see comments in `resolve`).
    let link_snapshots = create_link_snapshots(&master_data);

    // 5. Merge our plugin into masters
    plugin.merge_into(&mut master_data);

    // 6. Sort journal groups by index
    for (topic_id, group) in master_data.dialogues.iter_mut() {
        if touched_journal_topics.contains(topic_id)
            && group.dialogue.dialogue_type == DialogueType2::Journal
        {
            group
                .infos
                .make_contiguous()
                .sort_by_key(|info| info.data.disposition);
            group.repair_links();
        }
    }

    // 7. Mark infos modified when links changed, and record link-only
    //    modifications so callers (e.g., unpack/export) can ignore them.
    let mut link_only_changes: Vec<(String, String)> = Vec::new();
    for (dialogue_id, group) in master_data.dialogues.iter_mut() {
        if let Some(snapshots) = link_snapshots.get(dialogue_id) {
            for info in group.infos.iter_mut().skip_while(|info| info.modified()) {
                if let Some((old_prev, old_next, old_content)) = snapshots.get(&info.id) {
                    if info.prev_id != *old_prev || info.next_id != *old_next {
                        // Mark modified as before so the info survives pruning.
                        info.set_modified(true);

                        // Determine whether only prev/next changed by comparing
                        // the content snapshot (excluding the links).
                        let current = InfoSnapshot::from(&*info);

                        if &current == old_content {
                            link_only_changes.push((dialogue_id.clone(), info.id.clone()));
                        }
                    }
                }
            }
        }
    }

    // NOTE: We intentionally skip remove_unmodified() and set_all_modified(false)
    // so the full merged database stays in memory with modified flags intact.

    // Restore original masters list
    master_data.header.masters = original_masters;
    master_data.header.file_type = tes3::esp::FileType::Esp;
    master_data.header.num_objects = 0;

    Ok((master_data, link_only_changes))
}
