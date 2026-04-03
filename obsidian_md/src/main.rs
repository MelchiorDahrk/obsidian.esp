#![allow(unused)]

use std::path::{Path, PathBuf};

use anyhow::Result;
use openmw_config::OpenMWConfiguration;
use vfstool_lib::VFS;

use merge_to_master::traits::*;
use merge_to_master::{Cells, Dialogues, Objects, PluginData};

use obsidian_md::logging::*;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

/// Returns the absolute paths of the plugins in the users load order.
///
fn collect_load_order() -> Vec<PathBuf> {
    // This takes care of finding the users `openmw.cfg` file and parsing it
    // into structures we can work with.
    let config = OpenMWConfiguration::new(None).unwrap();

    // Once we have the configuration, we can construct the virtual file system
    // from the users data directories. This will allow us to find the absolute
    // paths of their plugins.
    let vfs = VFS::from_directories(config.data_directories(), None);

    // We only care about TES3 plugins, so we filter the contents by extension.
    config
        .content_files_iter()
        .filter_map(move |entry| {
            let value = entry.value();
            let path = Path::new(value);
            let ext = path.extension()?;
            let bytes = ext.as_encoded_bytes();
            if bytes.eq_ignore_ascii_case(b"esm")
                || bytes.eq_ignore_ascii_case(b"esp")
                || bytes.eq_ignore_ascii_case(b"omwgame")
                || bytes.eq_ignore_ascii_case(b"omwaddon")
            {
                Some(vfs.get_file(value)?.path().into())
            } else {
                None
            }
        })
        .collect()
}

fn main() -> Result<()> {
    let _guard = init_logger();

    for path in collect_load_order() {
        info!("{}", path.display());
    }
    Ok(())
}
