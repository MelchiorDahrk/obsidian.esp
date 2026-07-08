# TODO

## 1. High Priority

### Frontmatter

-   Properties is missing all of the function variables
-   Should pull in all item and creature records from the masters as well (just need IDs)

### Quest Canvas Core

-   Link up to the next quest (when applicable)
-   List prerequisites (link to previous quests)
-   Show speaker more visibly
-   Add speaker variant issues
    -   Change to "Add variant" and make it a duplicate (author will change what's needed)
    -   Should insert right below the file clicked on (rather than putting it at the bottom of the topics)
    -   Doesn't copy results box or entire filter gate (refreshing fixes this, but maybe the quest should automatically refresh when making changes?)
-   Regenerate full quest layout should NEVER make changes to notes. It can bring up errors and suggest changes, but no changes without the author's consent
    -   For example, it often changes `Journal` to `Journal - Journal` in the Function field
-   The canvas is incorrectly not linking choices due to disposition mismatch (parent is 0, child is 90, they can still be linked)
-   Not correctly linking sub-quests `ABcm_HH_Mine` and `ABcm_HH_MineReport` which share the same name
-   Journal text string being included in a line (e.g. "; StartScript to Wait-One-Day which will give Journal ABcm_HH_MineReport 20") seems like it throws off the journal linking
    -   ; StartScript to Wait-One-Day which will give Journal ABcm_HH_MineReport 20
    -   Journal ABcm_HH_Mine 55
    -   BECOMES
    -   ; StartScript to Wait-One-Day which will give Journal ABcm_HH_MineReport 20\r
    -   And doesn't handle the journal 55 properly


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

### Data Refreshing

-   Make an easier workflow for updating the loaded ESM (including property file(s))
    -   Need a way to not destroy edited notes (maybe an option to override or not)
-   Create folder notes automatically for new topics/greetings/etc

### Dialogue Compilation

-   Option to open containing folder after compiling dialogue

## 6. Note Handling

-   Note options to insert above/below, etc should not work in the canvas or note view, just in the files view.
-   Allow copy/pasting filters between notes

## 7. Maintenance

### Linting

-   Fix ESLint errors
    -   `npm run lint` currently blocked by:
        -   Existing unrelated lint errors
        -   Git unavailable in current shell PATH
