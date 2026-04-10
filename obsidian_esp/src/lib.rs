#![allow(unused)]

pub mod logging;
pub use logging::*;
use tes3::esp::{Plugin, TES3Object};

pub mod compile;
pub mod export;
pub mod parse;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use anyhow::Result;
use openmw_config::OpenMWConfiguration;
use serde::{Deserialize, Serialize};
use vfstool_lib::VFS;

use merge_to_master::merge_load_order;
use merge_to_master::traits::*;
use merge_to_master::{Cells, Dialogues, Objects, PluginData};

/// Returns the absolute paths of all Morrowind plugins found in the user's OpenMW load order.
///
/// This function locates the `openmw.cfg` file, parses its data directories to build a
/// virtual file system (VFS), and then iterates through the content files to find
/// their corresponding absolute paths on disk.
pub fn collect_load_order() -> Vec<PathBuf> {
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

/// Given a list of master plugin names, returns their absolute paths and file sizes.
///
/// It searches for each master name within the user's load order (retrieved via
/// `collect_load_order`). The file size is required for the TES3 header's master list.
pub fn collect_master_paths(master_names: &[String]) -> (Vec<PathBuf>, Vec<(String, u64)>) {
    let load_order = collect_load_order();

    let mut master_paths = Vec::with_capacity(master_names.len());
    let mut master_sizes = Vec::with_capacity(master_names.len());

    for name in master_names {
        for plugin_path in &load_order {
            if let Some(file_name) = plugin_path.file_name()
                && file_name
                    .as_encoded_bytes()
                    .eq_ignore_ascii_case(name.as_bytes())
                && let Ok(metadata) = plugin_path.metadata()
            {
                master_paths.push(plugin_path.clone());
                master_sizes.push((name.clone(), metadata.len()));
                break; // Found the master
            }
        }
    }

    (master_paths, master_sizes)
}

use js_sys::{Array, Uint8Array};
use js_sys::{Object, Reflect};
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

static BYTE_INGRESS_COUNTER: AtomicUsize = AtomicUsize::new(0);

fn record_byte_ingress() {
    BYTE_INGRESS_COUNTER.fetch_add(1, Ordering::Relaxed);
}

fn load_plugin_from_slice(bytes: &[u8]) -> Result<Plugin, JsValue> {
    record_byte_ingress();
    let mut plugin = Plugin::new();
    plugin
        .load_bytes(bytes)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(plugin)
}

fn load_plugin_from_buffer(bytes: &PluginBytes) -> Result<Plugin, JsValue> {
    let mut plugin = Plugin::new();
    plugin
        .load_bytes(bytes.as_slice())
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(plugin)
}

/// A WASM-owned plugin byte buffer.
///
/// This is the single intended JS -> WASM ingress point for large TES3 binary payloads
/// used during database loading.
#[wasm_bindgen]
pub struct PluginBytes {
    bytes: Vec<u8>,
}

#[wasm_bindgen]
impl PluginBytes {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> PluginBytes {
        record_byte_ingress();
        PluginBytes {
            bytes: bytes.to_vec(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn len(&self) -> usize {
        self.bytes.len()
    }
}

impl PluginBytes {
    fn as_slice(&self) -> &[u8] {
        &self.bytes
    }
}

#[wasm_bindgen(js_name = "resetByteIngressCounter")]
pub fn reset_byte_ingress_counter() {
    BYTE_INGRESS_COUNTER.store(0, Ordering::Relaxed);
}

#[wasm_bindgen(js_name = "getByteIngressCounter")]
pub fn get_byte_ingress_counter() -> usize {
    BYTE_INGRESS_COUNTER.load(Ordering::Relaxed)
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct PropertyExtractionOptions {
    include_factions: bool,
    include_races: bool,
    include_classes: bool,
    include_ids: bool,
    include_cells: bool,
}

#[derive(Default, Serialize)]
struct PropertyValueSet {
    factions: Vec<String>,
    races: Vec<String>,
    classes: Vec<String>,
    ids: Vec<String>,
    cells: Vec<String>,
}

/// Inserts a value into a collection if it's not already present, performing case-insensitive
/// matching but preserving the original casing of the first instance found.
fn push_unique_value(values: &mut BTreeMap<String, String>, value: &str) {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return;
    }

    values
        .entry(trimmed.to_ascii_lowercase())
        .or_insert_with(|| trimmed.to_string());
}

/// Iterates through a plugin's objects and extracts unique ID/Name values for specific
/// record types (Factions, Races, Classes, etc.) based on the provided options.
///
/// This is primarily used to provide autocomplete data to the Obsidian plugin.
fn collect_property_values(
    plugin: Plugin,
    options: &PropertyExtractionOptions,
) -> PropertyValueSet {
    let mut factions = BTreeMap::new();
    let mut races = BTreeMap::new();
    let mut classes = BTreeMap::new();
    let mut ids = BTreeMap::new();
    let mut cells = BTreeMap::new();

    for object in plugin.objects {
        match object {
            TES3Object::Faction(record) if options.include_factions => {
                push_unique_value(&mut factions, &record.id);
            }
            TES3Object::Race(record) if options.include_races => {
                push_unique_value(&mut races, &record.id);
            }
            TES3Object::Class(record) if options.include_classes => {
                push_unique_value(&mut classes, &record.id);
            }
            TES3Object::Npc(record) if options.include_ids => {
                push_unique_value(&mut ids, &record.id);
            }
            TES3Object::Creature(record) if options.include_ids => {
                push_unique_value(&mut ids, &record.id);
            }
            TES3Object::Cell(record) if options.include_cells => {
                push_unique_value(&mut cells, &record.name);
            }
            _ => {}
        }
    }

    PropertyValueSet {
        factions: factions.into_values().collect(),
        races: races.into_values().collect(),
        classes: classes.into_values().collect(),
        ids: ids.into_values().collect(),
        cells: cells.into_values().collect(),
    }
}

/// Returns a fallback `ParsedHeader` used when no `header.yaml` is provided in the project.
fn default_header() -> parse::ParsedHeader {
    parse::ParsedHeader {
        author: String::new(),
        description: String::new(),
        file_type: "ESP".to_string(),
        masters: vec!["Morrowind.esm".to_string()],
    }
}

/// Compiles a set of Markdown files and an optional header into a binary TES3 plugin (`.esp`).
///
/// Under the hood, this calls `compile_project_files_with_log` and discards the log output.
pub fn compile_project_files(
    files: Vec<(String, String)>,
    allow_default_header: bool,
    force_esp: bool,
) -> Result<Vec<u8>, String> {
    compile_project_files_with_log(files, allow_default_header, force_esp, vec![])
        .map(|(bytes, _log)| bytes)
}

/// The core project compilation routine.
///
/// 1. Parses Markdown project files into an internal representation.
/// 2. Validates the project against provided master plugin data (for ID/Script checking).
/// 3. Compiles the internal representation into TES3 records.
/// 4. Serializes the records into the final plugin byte array.
///
/// Returns the binary plugin data and a compilation/validation log string.
pub fn compile_project_files_with_log(
    files: Vec<(String, String)>,
    allow_default_header: bool,
    force_esp: bool,
    masters: Vec<(String, Vec<u8>)>,
) -> Result<(Vec<u8>, String), String> {
    let default_header = allow_default_header.then(default_header);
    let parsed =
        parse::parse_project_files(files, default_header).map_err(|error| error.to_string())?;
    let authored_masters = parsed.header.masters.clone();
    let log = compile::validate::validate_project(&parsed, &masters)
        .map_err(|error| error.to_string())?;

    let mut compiled = compile::compile(parsed).map_err(|error| error.to_string())?;
    compiled.header.masters = authored_masters
        .into_iter()
        .map(|master_name| (master_name, 0))
        .collect();

    let mut plugin = compiled.into_plugin();

    if let Some(header) = plugin.header_mut()
        && force_esp
    {
        header.file_type = tes3::esp::FileType::Esp;
    }

    let bytes = plugin.save_bytes().map_err(|error| error.to_string())?;
    Ok((bytes, log))
}

/// Deserializes a TES3 plugin from bytes into a `JsValue` containing an array of records.
#[wasm_bindgen]
pub fn load_objects(array: &[u8]) -> Result<JsValue, JsValue> {
    let plugin = load_plugin_from_slice(array)?;

    let value = to_value(&plugin.objects)?;

    Ok(value)
}

/// Serializes an array of records from a `JsValue` into a TES3 plugin byte array.
#[wasm_bindgen]
pub fn save_objects(value: JsValue) -> Result<Uint8Array, JsValue> {
    let mut plugin = Plugin {
        objects: from_value(value)?,
    };

    let bytes = plugin
        .save_bytes()
        .map_err(|e| JsValue::from(e.to_string()))?;

    let length = u32::try_from(bytes.len()) //
        .map_err(|e| JsValue::from(e.to_string()))?;

    let array = Uint8Array::new_with_length(length);
    array.copy_from(&bytes);

    Ok(array)
}

/// Compiles a project (Markdown files) into a TES3 plugin.
#[wasm_bindgen]
pub fn compile_project(files: JsValue, allow_default_header: bool) -> Result<Uint8Array, JsValue> {
    let files: Vec<(String, String)> = from_value(files)?;
    let bytes = compile_project_files(files, allow_default_header, /*force_esp*/ true)
        .map_err(JsValue::from)?;

    let length = u32::try_from(bytes.len()).map_err(|error| JsValue::from(error.to_string()))?;
    let array = Uint8Array::new_with_length(length);
    array.copy_from(&bytes);

    Ok(array)
}

/// Compiles a project (Markdown files) into a TES3 plugin and returns both the bytes and a log.
///
/// `masters` should be a JS array of `[name: string, bytes: Uint8Array]` pairs for validation.
#[wasm_bindgen]
pub fn compile_project_with_log(
    files: JsValue,
    allow_default_header: bool,
    masters: JsValue,
) -> Result<JsValue, JsValue> {
    let files: Vec<(String, String)> = from_value(files)?;
    let masters: Vec<(String, Vec<u8>)> = from_value(masters)?;
    let (bytes, log) = compile_project_files_with_log(
        files,
        allow_default_header,
        /*force_esp*/ true,
        masters,
    )
    .map_err(JsValue::from)?;

    let length = u32::try_from(bytes.len()).map_err(|error| JsValue::from(error.to_string()))?;
    let array = Uint8Array::new_with_length(length);
    array.copy_from(&bytes);

    let result = Object::new();
    Reflect::set(&result, &JsValue::from_str("bytes"), &array.into())?;
    Reflect::set(&result, &JsValue::from_str("log"), &JsValue::from_str(&log))?;

    Ok(result.into())
}

/// Extracts unique property values (IDs, Names) from a plugin for use in UI autocompletion.
#[wasm_bindgen]
pub fn extract_property_values(array: &[u8], options: JsValue) -> Result<JsValue, JsValue> {
    let plugin = load_plugin_from_slice(array)?;

    let options: PropertyExtractionOptions = from_value(options)?;
    let values = collect_property_values(plugin, &options);

    to_value(&values).map_err(Into::into)
}

/// Parse raw plugin bytes and return the master names from the header as a JS string array.
/// Lightweight — avoids creating a full GameDatabase just to read the header.
#[wasm_bindgen(js_name = "extractMasterNames")]
pub fn extract_master_names(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let plugin = load_plugin_from_slice(bytes)?;
    let names: Vec<String> = plugin
        .header()
        .map(|h| h.masters.iter().map(|(name, _)| name.clone()).collect())
        .unwrap_or_default();
    to_value(&names).map_err(Into::into)
}

/// A full game database loaded into WASM memory.
/// Constructed from raw ESP/ESM bytes; kept alive as long as the JS handle exists.
#[wasm_bindgen]
pub struct GameDatabase {
    data: PluginData,
    merged: bool,
    link_only_changes: Vec<(String, String)>,
}

#[wasm_bindgen]
impl GameDatabase {
    /// Parse raw ESP/ESM bytes into a structured PluginData held in WASM memory.
    #[wasm_bindgen(constructor)]
    pub fn load(bytes: &[u8]) -> Result<GameDatabase, JsValue> {
        let plugin = load_plugin_from_slice(bytes)?;
        let data = PluginData::from_plugin(plugin);
        Ok(GameDatabase {
            data,
            merged: false,
            link_only_changes: Vec::new(),
        })
    }

    /// Parse raw ESP/ESM bytes from a WASM-owned buffer into a structured `PluginData`.
    #[wasm_bindgen(js_name = "loadFromBytes")]
    pub fn load_from_bytes(bytes: &PluginBytes) -> Result<GameDatabase, JsValue> {
        let plugin = load_plugin_from_buffer(bytes)?;
        let data = PluginData::from_plugin(plugin);
        Ok(GameDatabase {
            data,
            merged: false,
            link_only_changes: Vec::new(),
        })
    }

    /// Load a plugin merged with its masters into a single resolved database.
    /// `masters_js` is a JS array of `[name: string, bytes: Uint8Array]` pairs.
    #[wasm_bindgen(js_name = "loadWithMasters")]
    pub fn load_with_masters(
        plugin_bytes: &[u8],
        masters_js: JsValue,
    ) -> Result<GameDatabase, JsValue> {
        let master_entries: Vec<(String, Vec<u8>)> =
            from_value(masters_js).map_err(|e| JsValue::from_str(&e.to_string()))?;

        // Parse plugin
        let mut plugin_raw = Plugin::new();
        plugin_raw
            .load_bytes(plugin_bytes)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        // Save original masters list before conversion
        let original_masters: Vec<(String, u64)> = plugin_raw
            .header()
            .map(|h| h.masters.clone())
            .unwrap_or_default();

        let plugin_data = PluginData::from_plugin(plugin_raw);

        // Parse each master into PluginData
        let mut master_datas = Vec::with_capacity(master_entries.len());
        for (name, bytes) in master_entries {
            let mut master_raw = Plugin::new();
            master_raw
                .load_bytes(&bytes)
                .map_err(|e| JsValue::from_str(&format!("Failed to load master '{name}': {e}")))?;
            master_datas.push(PluginData::from_plugin(master_raw));
        }

        let (data, link_only_changes) =
            compile::resolve::resolve_full_database(plugin_data, master_datas, original_masters)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;

        Ok(GameDatabase {
            data,
            merged: true,
            link_only_changes,
        })
    }

    /// Load a plugin merged with pre-parsed masters.
    /// `masters_js` is a JS array of object arrays (obtained via `load_objects` on workers).
    #[wasm_bindgen(js_name = "loadWithPreparsedMasters")]
    pub fn load_with_preparsed_masters(
        plugin_bytes: &[u8],
        masters_js: JsValue,
    ) -> Result<GameDatabase, JsValue> {
        let master_objects: Vec<Vec<TES3Object>> = from_value(masters_js).map_err(|e| {
            JsValue::from_str(&format!("Failed to deserialize master objects: {e}"))
        })?;

        // Parse plugin
        let mut plugin_raw = Plugin::new();
        plugin_raw
            .load_bytes(plugin_bytes)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        // Save original masters list before conversion
        let original_masters: Vec<(String, u64)> = plugin_raw
            .header()
            .map(|h| h.masters.clone())
            .unwrap_or_default();

        let plugin_data = PluginData::from_plugin(plugin_raw);

        // Convert object lists to PluginData
        let master_datas: Vec<PluginData> = master_objects
            .into_iter()
            .map(|objects| PluginData::from_plugin(Plugin { objects }))
            .collect();

        let (data, link_only_changes) =
            compile::resolve::resolve_full_database(plugin_data, master_datas, original_masters)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;

        Ok(GameDatabase {
            data,
            merged: true,
            link_only_changes,
        })
    }

    /// Load a plugin merged with master buffers that already live in this WASM instance.
    #[wasm_bindgen(js_name = "loadWithMasterBuffers")]
    pub fn load_with_master_buffers(
        plugin_bytes: &PluginBytes,
        masters_js: JsValue,
    ) -> Result<GameDatabase, JsValue> {
        let master_entries: Vec<(String, Vec<u8>)> =
            from_value(masters_js).map_err(|e| JsValue::from_str(&e.to_string()))?;

        let plugin_raw = load_plugin_from_buffer(plugin_bytes)?;

        let original_masters: Vec<(String, u64)> = plugin_raw
            .header()
            .map(|h| h.masters.clone())
            .unwrap_or_default();

        let plugin_data = PluginData::from_plugin(plugin_raw);

        let mut master_datas = Vec::with_capacity(master_entries.len());
        for (name, bytes) in master_entries {
            record_byte_ingress();
            let mut master_raw = Plugin::new();
            master_raw.load_bytes(&bytes).map_err(|e| {
                JsValue::from_str(&format!("Failed to load master '{name}': {e}"))
            })?;
            master_datas.push(PluginData::from_plugin(master_raw));
        }

        let (data, link_only_changes) =
            compile::resolve::resolve_full_database(plugin_data, master_datas, original_masters)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;

        Ok(GameDatabase {
            data,
            merged: true,
            link_only_changes,
        })
    }

    /// Whether this database was loaded with masters (merged mode).
    #[wasm_bindgen(js_name = "isMerged")]
    pub fn is_merged(&self) -> bool {
        self.merged
    }

    /// Total number of records in the database.
    #[wasm_bindgen(js_name = "objectCount")]
    pub fn object_count(&self) -> usize {
        self.data.count_objects()
    }

    /// Returns all Activator records as a serialized JS array.
    #[wasm_bindgen(js_name = "getActivators")]
    pub fn get_activators(&self) -> Result<JsValue, JsValue> {
        let activators: Vec<&tes3::esp::Activator> = self
            .data
            .objects
            .values()
            .filter_map(|obj| match obj {
                TES3Object::Activator(a) => Some(a),
                _ => None,
            })
            .collect();
        to_value(&activators).map_err(Into::into)
    }

    /// Unpacks the database into markdown project files.
    #[wasm_bindgen]
    pub fn unpack(&self) -> Result<JsValue, JsValue> {
        let files = export::collect_project_files(&self.data);

        let result = Array::new();
        for (path, content) in files {
            let pair = Array::new();
            pair.push(&JsValue::from_str(&path));
            pair.push(&JsValue::from_str(&content));
            result.push(&pair);
        }

        Ok(result.into())
    }

    /// Unpacks only the modified (plugin-owned) dialogues into markdown project files.
    #[wasm_bindgen(js_name = "unpackModified")]
    pub fn unpack_modified(&self) -> Result<JsValue, JsValue> {
        let mut files = export::collect_modified_project_files(&self.data);

        // Filter out files that only had link-pointer (prev/next) changes.
        self.filter_link_only_changes(&mut files);

        let result = Array::new();
        for (path, content) in files {
            let pair = Array::new();
            pair.push(&JsValue::from_str(&path));
            pair.push(&JsValue::from_str(&content));
            result.push(&pair);
        }

        Ok(result.into())
    }

    /// Returns a sorted list of all topic names in the database.
    #[wasm_bindgen(js_name = "getAllTopicNames")]
    pub fn get_all_topic_names(&self) -> Result<JsValue, JsValue> {
        let names = export::collect_all_topic_names(&self.data);
        to_value(&names).map_err(Into::into)
    }

    /// Unpacks a single topic's info files (for lazy loading).
    /// The topic is looked up case-insensitively.
    #[wasm_bindgen(js_name = "unpackTopic")]
    pub fn unpack_topic(&self, topic_name: &str) -> Result<JsValue, JsValue> {
        let files = export::collect_single_topic_files(&self.data, topic_name);

        let result = Array::new();
        for (path, content) in files {
            let pair = Array::new();
            pair.push(&JsValue::from_str(&path));
            pair.push(&JsValue::from_str(&content));
            result.push(&pair);
        }

        Ok(result.into())
    }

    /// Prunes a list of generated files by removing any dialogue blocks that only
    /// contain "structural" link changes and no "semantic" content changes.
    ///
    /// This prevents the user's workspace from being cluttered with hundreds of
    /// "modified" files when they only changed the order of responses in a topic.
    fn filter_link_only_changes(&self, files: &mut Vec<(String, String)>) {
        if self.link_only_changes.is_empty() {
            return;
        }

        use std::collections::HashSet;
        let ignore: HashSet<_> = self.link_only_changes.iter().collect();
        files.retain(|(_path, content)| {
            if let Some((t, d)) = self.parse_frontmatter_values(content) {
                !ignore.contains(&(t, d))
            } else {
                true
            }
        });
    }

    /// Parses the `Topic` and `DiagID` fields from a Markdown file's YAML frontmatter.
    ///
    /// This is a lightweight parser used specifically for filtering link-only changes
    /// during the export pass.
    fn parse_frontmatter_values(&self, s: &str) -> Option<(String, String)> {
        let mut topic: Option<String> = None;
        let mut diagid: Option<String> = None;
        for line in s.lines() {
            if line.starts_with("Topic:") {
                topic = Some(line["Topic:".len()..].trim().to_string());
            } else if line.starts_with("DiagID:") {
                diagid = Some(line["DiagID:".len()..].trim().to_string());
            }
            if topic.is_some() && diagid.is_some() {
                break;
            }
        }
        match (topic, diagid) {
            (Some(t), Some(d)) => Some((t, d)),
            _ => None,
        }
    }

    /// Evaluates a list of markdown file contents and returns the paths of those that 
    /// are "incidental" (i.e. functionally identical to the master database).
    #[wasm_bindgen(js_name = "findIncidentalEdits")]
    pub fn find_incidental_edits(&self, files: JsValue) -> Result<JsValue, JsValue> {
        let files: Vec<(String, String)> = from_value(files)?;
        let parsed = parse::parse_project_files(files.clone(), Some(default_header()))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let compiled = compile::compile(parsed).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let plugin_data = PluginData::from_plugin(compiled.into_plugin());

        let result = Array::new();
        
        for (path, content) in files {
            if let Some((topic, diagid)) = self.parse_frontmatter_values(&content) {
                // Does this vault topic exist in the compiled set?
                if let Some(group) = plugin_data.dialogues.get(&topic.to_ascii_lowercase()) {
                    if let Some(authored_info) = group.infos.iter().find(|i| i.id.eq_ignore_ascii_case(&diagid)) {
                        // Does it exist in the master database?
                        if let Some(master_group) = self.data.dialogues.get(&topic.to_ascii_lowercase()) {
                            if let Some(master_info) = master_group.infos.iter().find(|i| i.id.eq_ignore_ascii_case(&diagid)) {
                                // Edits are considered "incidental" if they are functionally identical to the 
                                // master. A key part of this is that the `prev_id` and `next_id` link 
                                // pointers are managed automatically by our runtime list builder.
                                // If a record was only modified because a new plugin-defined record was 
                                // inserted next to it, the engine will reconcile those pointers 
                                // automatically—meaning the master-defined record doesn't need to be 
                                // included in our plugin at all. 
                                let mut authored_clone = authored_info.clone();
                                authored_clone.prev_id = master_info.prev_id.clone();
                                authored_clone.next_id = master_info.next_id.clone();
                                
                                if authored_clone == *master_info {
                                    result.push(&JsValue::from_str(&path));
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(result.into())
    }
}
