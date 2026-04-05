use tes3::esp::{Plugin, TES3Object};
use std::collections::HashSet;

fn main() {
    let mut plugin = Plugin::new();
    // Just testing field existence
    for object in plugin.objects {
        match object {
            TES3Object::Npc(record) => {
                let _ = &record.script;
                let _ = &record.id;
            }
            TES3Object::Creature(record) => {
                let _ = &record.script;
                let _ = &record.id;
            }
            TES3Object::Script(record) => {
                let _ = &record.variables;
                let _ = &record.id;
            }
            _ => {}
        }
    }
}
