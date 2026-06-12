---
name: obsidian-bases
description: Author, edit, and debug Obsidian Bases syntax, functions, and view configurations. Use this skill whenever the user mentions .base files, database-like views in Obsidian, formula properties, filtering notes into tables/cards, or the Bases plugin.
---

# Obsidian Bases

A skill for working with the **Obsidian Bases** core plugin. Obsidian Bases allows users to create database-like views of their notes using either `.base` files or embedded code blocks.

## Trigger Instructions

Trigger this skill when the user:
- Asks to create or modify a `.base` file.
- Wants to display notes in a **Table**, **List**, **Cards**, or **Map** view.
- Needs help with **formula properties** or **filters** in Obsidian.
- Mentions **Bases syntax**, **summaries**, or **calculated properties**.
- Is debugging a YAML error in an Obsidian base.

## Core Concepts

### 1. File Structure
Bases must be valid YAML. The primary sections are:
- `filters`: Global conditions applied to all views.
- `formulas`: Calculated properties defined at the base level.
- `properties`: Display configuration for note/file/formula properties.
- `summaries`: Custom summary formulas (e.g., averages, counts).
- `views`: A list of view configurations (Table, Cards, etc.).

### 2. Properties
- **Note properties**: `note.author` or just `author`. From YAML frontmatter.
- **File properties**: `file.name`, `file.mtime`, `file.size`, etc.
- **Formula properties**: `formula.my_calc`.

### 3. Contextual `this`
- **Main Editor**: `this` refers to the `.base` file itself.
- **Embedded**: `this` refers to the embedding note/Canvas.
- **Sidebar**: `this` refers to the active file.

---

## Usage Guide

### Filters
Filters can be strings or nested objects using `and`, `or`, and `not`.
```yaml
filters:
  and:
    - file.hasTag("project")
    - status == "active"
```

### Formulas
Formulas use JavaScript-like syntax with built-in functions.
```js
formulas:
  progress: 'if(tasks_total, (tasks_done / tasks_total) * 100, 0)'
```

### View Configurations
Each view requires a `type` and `name`. Optional keys: `limit`, `groupBy`, `order`, `summaries`.

#### View Types
- **table**: Standard rows and columns. Supports `rowHeight` (short, medium, tall, extra tall) and column summaries.
- **cards**: Gallery grid. Supports `cardSize`, `imageProperty`, `imageFit` (cover, contain), and `imageAspectRatio`.
- **map**: Interactive map (requires Maps plugin). Supports `markerCoordinates`, `markerIcon`, `markerColor`.
- **list**: Bulleted/numbered list. Supports `markers` (bullets, numbers, none) and `indentProperties`.

---

## Detailed References

Refer to these files for more information:
- [functions.md](file:///d:/Games/Morrowind/Repositories/obsidian.esp/obsidian_esp/.agents/skills/obsidian-bases/references/functions.md) - Complete function and operator list.
- [syntax_examples.md](file:///d:/Games/Morrowind/Repositories/obsidian.esp/obsidian_esp/.agents/skills/obsidian-bases/references/syntax_examples.md) - Full `.base` file examples and common patterns.
