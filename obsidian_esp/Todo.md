# TODO

## 1. High Priority

### Quest Canvas Core

-   Link up to the next quest (when applicable)
-   List prerequisites (link to previous quests)
-   Show speaker more visibly

## 2. Quest System

### Sub-Quests

-   Add **Parent Quest** property
    -   If assigned to a journal folder: treat contained journal entries as belonging to the parent quest

### Jump Nodes

-   Detect dialogue nodes with journal ranges
    (e.g. `Journal < 30 & Journal >= 20`)
-   If multiple incoming connections:
    -   Lowest journal stage connection stays normal
    -   Remaining incoming connections become Jump Nodes
-   Reference:
    -   `The Eerie Lantern - modified`

## 3. Quest Canvas Improvements

### Selection

-   Select Connected
-   Invert Selection

### UI

-   Choices should display `#`
-   Autocomplete doesn't work in Quest Inspector
-   Support every Functions option in the Quest Inspector
-   Combine filter, result, and text into a single card

### Validation

-   Don't add `= journal stage` when adding connections if already implied
    -   Example:
        -   Existing range includes stage 20
        -   Copying speaker should **not** append `= 20`

### Organization

-   Move new Quest Canvas commands into:
    -   `obsidian.esp/commands`
-   Remove loose command files

## 4. Data Generation

### Automatic Properties

-   Automatically generate properties when unpacking an ESP
    -   This should happen dynamically. Not be a button that needs to be pressed

## 5. Workflow Improvements

### Dialogue Compilation

-   Option to open containing folder after compiling dialogue

## 6. Maintenance

### Linting

-   Fix ESLint errors
    -   `npm run lint` currently blocked by:
        -   Existing unrelated lint errors
        -   Git unavailable in current shell PATH
