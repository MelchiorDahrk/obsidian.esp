use anyhow::Result;
use merge_to_master::traits::MergeInto;
use merge_to_master::{DialogueGroup, Exterior, Interior, PluginData, merge_load_order};
use std::path::PathBuf;
use tes3::esp::ObjectInfo;

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

    // 4. Merge our plugin into masters
    plugin.merge_into(&mut master_data);

    // 5. Prune unmodified
    master_data.remove_unmodified();

    // 6. Restore original masters list
    master_data.header.masters = original_masters;

    // The previous file type might have been ESM, so switch back to ESP
    master_data.header.file_type = tes3::esp::FileType::Esp;
    // Num objects is calculated dynamically on save, so we can ignore it
    master_data.header.num_objects = 0;

    Ok(master_data)
}
