use anyhow::Result;
use merge_to_master::traits::MergeInto;
use merge_to_master::{DialogueGroup, Exterior, Interior, PluginData, merge_load_order};
use std::path::PathBuf;
use tes3::esp::{ObjectFlags, ObjectInfo};

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

pub fn resolve(
    mut plugin: PluginData,
    master_paths: &[PathBuf],
    original_masters: Vec<(String, u64)>,
) -> Result<PluginData> {
    // 1. Merge load order to get masters
    let mut master_data = merge_load_order(master_paths)?;

    // 2. Set modified=false on masters
    master_data.set_all_modified(false);

    // 3. Set modified=true on plugin content
    plugin.set_all_modified(true);

    // 4. Snapshot the prev_id/next_id of all master dialogue infos *before* merging.
    //    After merge_into, repair_links() will update these links in-place on master infos
    //    that are still marked modified=false. We need to detect those link changes so we
    //    can mark those infos as modified and include them in the output.
    use std::collections::HashMap;
    let mut link_snapshots: HashMap<_, _> = master_data
        .dialogues
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
                    (info_id, (prev_id, next_id))
                })
                .collect();
            (key, snapshot)
        })
        .collect();

    // 5. Merge our plugin into masters (also calls repair_links inside)
    plugin.merge_into(&mut master_data);

    // 6. Mark any master info whose links changed as modified so it survives pruning.
    for group in master_data.dialogues.values_mut() {
        let Some(snapshots) = link_snapshots.get(&group.dialogue.id) else {
            continue;
        };
        for info in group.infos.iter_mut().skip_while(|info| info.modified()) {
            if let Some((old_prev, old_next)) = snapshots.get(&info.id) {
                if info.prev_id != *old_prev || info.next_id != *old_next {
                    info.set_modified(true);
                }
            }
        }
    }

    // 7. Prune unmodified
    master_data.remove_unmodified();
    master_data.set_all_modified(false);

    // 8. Restore original masters list
    master_data.header.masters = original_masters;

    // The previous file type might have been ESM, so switch back to ESP
    master_data.header.file_type = tes3::esp::FileType::Esp;
    // Num objects is calculated dynamically on save, so we can ignore it
    master_data.header.num_objects = 0;

    Ok(master_data)
}
