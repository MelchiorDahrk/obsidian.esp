# Obsidian Bases Function Reference

Bases supports a wide range of global and type-specific functions for use in **formulas** and **filters**.

## Operators

| Type | Operators |
| --- | --- |
| **Arithmetic** | `+`, `-`, `*`, `/`, `%`, `( )` |
| **Comparison** | `==`, `!=`, `>`, `<`, `>=`, `<=` |
| **Boolean** | `!`, `&&`, `||` |

### Date Arithmetic
- Add durations to dates: `now() + "1d"`, `today() - "2w"`.
- Duration units: `y`, `year`, `M`, `month`, `d`, `day`, `w`, `week`, `h`, `hour`, `m`, `minute`, `s`, `second`.

---

## Global Functions

- `if(condition, trueResult, falseResult?)`: Returns `trueResult` if `condition` is truthy, otherwise `falseResult` (or `null`).
- `date(string)`: Parses a string like `"YYYY-MM-DD HH:mm:ss"` into a date.
- `duration(string)`: Parses a string into a duration (e.g., `"1d"`).
- `file(path | link)`: Returns a file object for the given path or link.
- `html(string)`: Renders a string as HTML.
- `image(path | file | url)`: Renders an image.
- `icon(name)`: Renders a Lucide icon by name (e.g., `icon("arrow-right")`).
- `link(path, display?)`: Creates a Link object. `display` is optional.
- `list(element)`: Wraps an element in a list if it's not already one.
- `max(v1, v2...)` / `min(v1, v2...)`: Returns the max or min numeric value.
- `now()`: Returns current date and time.
- `today()`: Returns current date (zeroed time).
- `number(input)`: Coerces a value to a number.
- `random()`: Returns a random number (0–1).

---

## Any Type Methods

- `.isTruthy()`: Returns boolean coercion.
- `.isType(type)`: Returns true if the value is of the specified type (e.g., `"string"`, `"boolean"`).
- `.toString()`: Returns a string representation.

---

## Type-Specific Methods

### String
- `.length`: Property. Number of characters.
- `.contains(value)` / `.containsAll(...)` / `.containsAny(...)`: Substring search.
- `.startsWith(query)` / `.endsWith(query)`: Prefix/suffix check.
- `.isEmpty()`: Returns true if length is 0 or value is missing.
- `.lower()` / `.title()`: Cascading.
- `.replace(pattern, replacement)`: Search and replace (supports Regexp).
- `.repeat(count)` / `.reverse()` / `.trim()`: Utility functions.
- `.slice(start, end?)`: Substring extraction.
- `.split(separator, limit?)`: Returns a list of substrings.

### Number
- `.abs()` / `.ceil()` / `.floor()`: Math utilities.
- `.round(digits?)`: Rounds to the nearest integer or specified decimal places.
- `.toFixed(precision)`: Returns fixed-point string.
- `.isEmpty()`: Returns true if number is missing.

### List
- `.length`: Property. Number of elements.
- `.contains(value)` / `.containsAll(...)` / `.containsAny(...)`: Element search.
- `.filter(expression)`: Filters list using `value` and `index` variables (e.g., `items.filter(value > 10)`).
- `.map(expression)`: Transforms each element using `value` and `index`.
- `.reduce(expression, initialAcc)`: Accumulates values using `acc`, `value`, and `index`.
- `.flat()`: Flattens nested lists.
- `.join(separator)`: Joins elements into a string.
- `.reverse()` / `.sort()` / `.unique()` / `.slice(start, end?)`: List utilities.

### Date
- `.year`, `.month`, `.day`, `.hour`, `.minute`, `.second`, `.millisecond`: Fields.
- `.date()`: Returns a date with the time portion removed.
- `.format(momentString)`: Formats date using Moment.js syntax.
- `.time()`: Returns time portion as a string.
- `.relative()`: Returns relative time string (e.g., `"3 days ago"`).

### File
- `.name`, `.basename`, `.path`, `.folder`, `.ext`, `.size`: Fields.
- `.properties`: Access all frontmatter properties as an object.
- `.tags`, `.links`: List of tags and internal links.
- `.ctime`, `.mtime`: Created and modified timestamps.
- `.asLink(display?)`: Converts file object to a Link.
- `.hasLink(otherFile)` / `.hasTag(...tags)` / `.hasProperty(name)` / `.inFolder(folder)`: Boolean checks.

### Link
- `.asFile()`: Returns file object if local.
- `.linksTo(otherFile)`: Checks if the target file links to another file.

### Object
- `.keys()` / `.values()`: Returns lists of keys or values.
- `.isEmpty()`: Returns true if no properties.

### Regular Expression
- `.matches(string)`: Checks if the pattern matches a string.
