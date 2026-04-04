---
name: winnow-parsing
description: How to write idiomatic, clean text parsers using the winnow crate (v1.0). Use this skill whenever you need to write, modify, debug, or extend any parser combinator code in this project — including parsing markdown frontmatter, dialogue blocks, YAML-like key/value pairs, filters, script text, or any structured text. Also consult this skill when you encounter winnow compilation errors or want to understand winnow's error handling model.
---

# Winnow Parsing (v1.0)

This skill teaches you how to write correct, idiomatic parsers using `winnow 1.0.x`. Winnow is a parser combinator library — you build complex parsers by composing small, focused parsing functions together.

## Table of Contents

1. [Mental Model](#mental-model)
2. [Imports and Setup](#imports-and-setup)
3. [Writing a Parser Function](#writing-a-parser-function)
4. [Core Parsers](#core-parsers)
5. [Combinators](#combinators)
6. [Repetition and Collection](#repetition-and-collection)
7. [Transforming Output](#transforming-output)
8. [Error Handling](#error-handling)
9. [Application Integration](#application-integration)
10. [Patterns for This Project](#patterns-for-this-project)

---

## Mental Model

A winnow parser is a function that takes a **mutable reference** to an input and returns a `Result`:

```text
                                 ┌─► Ok(output)
             ┌────────┐         │
 &mut input──►│ parser ├──►either─┤
             └────────┘         └─► Err(error)
```

Key ideas:

- On **success**, the parser returns `Ok(output)` and the input is automatically advanced past whatever was consumed. The caller's input now points at the remaining, unparsed text.
- On **failure**, the parser returns an `Err` and the input is rewound automatically (for built-in combinators like `alt`). No manual checkpoint management is needed for typical usage.
- Parsers are **composable**: small parsers snap together like building blocks using tuples, `alt`, `preceded`, `repeat`, `seq!`, etc.
- The input type is usually `&str` for text parsing. You pass `&mut &str` to parsers.

---

## Imports and Setup

### Cargo.toml

The project already has winnow configured:

```toml
winnow = "1.0.1"
```

With default features, you get `std`, `ascii`, `binary`, and transitively `parser`. Everything you need for text parsing is available.

### Standard Import Block

Use this import pattern at the top of any parser module:

```rust
use winnow::prelude::*;       // Parser, ModalParser, ModalResult, trait impls
use winnow::Result;            // Simple Result<O> = Result<O, ContextError> (no ErrMode wrapper)
use winnow::combinator::*;     // alt, opt, repeat, preceded, delimited, seq!, etc.
use winnow::token::*;          // any, literal, one_of, none_of, take, take_while, take_till, take_until, rest
use winnow::ascii::*;          // digit1, alpha1, space0, space1, multispace0, line_ending, dec_uint, etc.
```

Import only what you need in practice. The above shows the full set of available modules.

---

## Writing a Parser Function

### The Canonical Signature

Every parser function follows this pattern:

```rust
fn my_parser<'s>(input: &mut &'s str) -> Result<MyOutput> {
    // ... parsing logic ...
}
```

- **`<'s>`**: The lifetime ties the returned slices to the input's lifetime.
- **`&mut &'s str`**: Mutable reference to a string slice. Winnow advances this automatically.
- **`Result<MyOutput>`**: Alias for `Result<MyOutput, ContextError>`. Use this for simple parsers.

For parsers that need error cuts (to short-circuit alternatives), use `ModalResult` instead:

```rust
fn my_parser<'s>(input: &mut &'s str) -> ModalResult<MyOutput> {
    // ... can use cut_err() inside ...
}
```

### Returning Borrowed vs Owned Data

- Return `&'s str` when you just want to extract a slice of the original input (zero-copy, fast).
- Return owned types (`String`, `Vec`, structs) when you need to transform the parsed data.

```rust
// Zero-copy: returns a slice of the input
fn parse_identifier<'s>(input: &mut &'s str) -> Result<&'s str> {
    (alpha1, take_while(0.., |c: char| c.is_alphanumeric() || c == '_'))
        .take()  // .take() captures the matched span as a &str
        .parse_next(input)
}

// Owned: returns a parsed integer
fn parse_number(input: &mut &str) -> Result<i32> {
    digit1.parse_to().parse_next(input)
}
```

---

## Core Parsers

These are found in `winnow::token` and are the atoms from which everything else is built.

### Matching Exact Text

```rust
// A string literal is itself a parser (returns the matched &str)
"hello".parse_next(input)          // matches exactly "hello"

// A char literal is itself a parser (returns the matched char)
'#'.parse_next(input)              // matches exactly '#'

// For case-insensitive matching:
use winnow::ascii::Caseless;
Caseless("topic").parse_next(input)  // matches "Topic", "TOPIC", "topic", etc.
```

### Single Token Parsers

```rust
any.parse_next(input)              // consumes and returns one char (or byte)
one_of(['a', 'b', 'c'])           // matches one char from the set
one_of('0'..='9')                  // matches one char in a range
none_of(['<', '>'])                // matches one char NOT in the set
```

### Slice Parsers

```rust
take(5usize).parse_next(input)         // takes exactly 5 chars/bytes
take_while(1.., |c: char| c.is_alphanumeric())   // 1 or more alphanumeric chars
take_while(0.., ('a'..='z', 'A'..='Z'))           // 0 or more letters (tuple of ranges)
take_till(0.., ['\n', '\r'])                       // take until newline
take_until(0.., "---")                             // take until literal "---" is found
rest.parse_next(input)                             // consume all remaining input
```

### ASCII Convenience Parsers (from `winnow::ascii`)

| Parser | Matches |
|---|---|
| `alpha0`, `alpha1` | `[a-zA-Z]*` / `[a-zA-Z]+` |
| `digit0`, `digit1` | `[0-9]*` / `[0-9]+` |
| `alphanumeric0`, `alphanumeric1` | `[a-zA-Z0-9]*` / `[a-zA-Z0-9]+` |
| `hex_digit0`, `hex_digit1` | `[0-9a-fA-F]*` / `[0-9a-fA-F]+` |
| `space0`, `space1` | `[ \t]*` / `[ \t]+` |
| `multispace0`, `multispace1` | `[ \t\r\n]*` / `[ \t\r\n]+` |
| `line_ending` | `\n` or `\r\n` |
| `newline` | `\n` |
| `till_line_ending` | everything up to (but not including) `\n` or `\r\n` |
| `dec_uint` | decimal unsigned integer → `u8`, `u16`, `u32`, `u64`, etc. |
| `dec_int` | decimal signed integer → `i8`, `i16`, `i32`, `i64`, etc. |
| `float` | floating point number |

---

## Combinators

These are found in `winnow::combinator` and compose parsers together.

### Sequencing

Tuples are the simplest way to sequence parsers. The output is a tuple of each parser's result:

```rust
// Parse "## " followed by a word — returns (&str, &str)
let (prefix, word) = ("## ", alpha1).parse_next(input)?;
```

When you want to discard some parts, use the dedicated combinators:

```rust
preceded("## ", alpha1)                        // discard prefix, return second
terminated(alpha1, line_ending)                // return first, discard suffix
delimited('"', take_till(0.., '"'), '"')       // discard both delimiters, return middle
separated_pair(alpha1, ": ", till_line_ending) // returns (first, third), discards separator
```

For complex sequences, use the `seq!` macro to build structs or skip fields:

```rust
use winnow::combinator::seq;

// Building a struct directly:
seq!(MyStruct {
    _: "## ",           // underscore = parse and discard
    name: alpha1,       // named field = parse and keep
    _: line_ending,
})
.parse_next(input)

// Tuple-like with discards:
seq!(_: "prefix: ", take_while(1.., |c: char| c != '\n'), _: line_ending)
    .parse_next(input)
// Returns just the middle value as a single &str (not a tuple)
```

### Alternatives

```rust
// Try each parser in order, return the first success
alt((
    "Topic".value(DialogueType::Topic),
    "Journal".value(DialogueType::Journal),
    "Greeting".value(DialogueType::Greeting),
    "Voice".value(DialogueType::Voice),
    "Persuasion".value(DialogueType::Persuasion),
)).parse_next(input)
```

For prefix-based dispatch (faster than `alt` when alternatives have unique prefixes):

```rust
use winnow::combinator::dispatch;
use winnow::token::take;

dispatch!(take(2usize);
    "0b" => parse_bin,
    "0x" => parse_hex,
    _ => fail,
).parse_next(input)
```

### Optional and Peeking

```rust
opt(line_ending).parse_next(input)    // returns Option<&str>, never fails
peek(alpha1).parse_next(input)        // look ahead without consuming
not('#').parse_next(input)            // succeeds only if '#' is NOT next (consumes nothing)
```

---

## Repetition and Collection

```rust
// Collect into a Vec
let items: Vec<&str> = repeat(0.., alpha1).parse_next(input)?;
let items: Vec<&str> = repeat(1..=3, alpha1).parse_next(input)?;

// Separated values → Vec
let items: Vec<u32> = separated(0.., dec_uint, ", ").parse_next(input)?;

// repeat_till: repeat until a terminator matches
let (items, _end): (Vec<&str>, _) = repeat_till(0.., parse_item, "END").parse_next(input)?;

// Fold: accumulate without allocating a Vec
let sum: u32 = repeat(1.., dec_uint::<_, u32, _>)
    .fold(|| 0u32, |acc, n| acc + n)
    .parse_next(input)?;

// Accumulate into () — useful with .take() to capture the span
let raw: &str = repeat::<_, _, (), _, _>(0.., parse_item)
    .take()
    .parse_next(input)?;
```

---

## Transforming Output

These are methods on the `Parser` trait, chained with dot-syntax:

```rust
// .map() — transform the output
digit1.map(|s: &str| s.len()).parse_next(input)

// .value() — replace the output with a fixed value
"true".value(true).parse_next(input)

// .default_value() — replace the output with Default::default()
space0.default_value().parse_next(input)   // returns ()

// .void() — discard the output (return ())
space0.void().parse_next(input)

// .parse_to() — use FromStr to convert the matched text
digit1.parse_to::<u32>().parse_next(input)

// .try_map() — apply a fallible function to the output
hex_digit1.try_map(|s| u32::from_str_radix(s, 16)).parse_next(input)

// .verify_map() — apply a function returning Option, fail on None
digit1.verify_map(|s: &str| s.parse::<u32>().ok()).parse_next(input)

// .verify() — check a condition on the output, fail if false
alpha1.verify(|s: &str| s.len() <= 32).parse_next(input)

// .take() — run inner parser, discard its result, return the consumed input slice
(alpha1, digit1).take().parse_next(input)  // e.g. "abc123" → "abc123"

// .with_taken() — return (consumed_slice, output)
dec_uint::<_, u32, _>.with_taken().parse_next(input)  // e.g. ("42", 42)

// .span() — return the byte range of consumed input
alpha1.span().parse_next(input)  // returns Range<usize>

// .with_span() — return (output, byte_range)
alpha1.with_span().parse_next(input)

// .context() — annotate errors (see Error Handling)
alpha1.context(StrContext::Label("identifier")).parse_next(input)
```

---

## Error Handling

Winnow has two result types reflecting two error strategies:

### Simple: `Result<O>` (alias for `Result<O, ContextError>`)

- No `ErrMode` wrapper. All errors are backtracking.
- Best for parsers that don't use `cut_err`.
- Simpler function signatures.

### Modal: `ModalResult<O>` (alias for `Result<O, ErrMode<ContextError>>`)

- The error is wrapped in `ErrMode`, which has two variants:
  - `ErrMode::Backtrack(e)` — the parser failed, but alternatives can be tried.
  - `ErrMode::Cut(e)` — the parser committed; stop trying alternatives immediately.
- Use this when you need `cut_err` for better error messages.

### When to Use `cut_err`

Use `cut_err` after matching a unique prefix that commits you to a specific parse path. This prevents the error from bubbling up through `alt` as a "wrong alternative" and instead reports it at the correct location.

```rust
fn parse_heading<'s>(input: &mut &'s str) -> ModalResult<(&'s str, &'s str)> {
    alt((
        ("## Topic ", cut_err(delimited('"', take_till(0.., '"'), '"'))),
        ("## Journal ", cut_err(delimited('"', take_till(0.., '"'), '"'))),
    )).parse_next(input)
}
```

Once `"## Topic "` matches, we *know* we're parsing a Topic heading. If the quoted ID is missing or malformed, `cut_err` ensures the error points at the quote instead of falling through to try `"## Journal "`.

### Adding Context to Errors

```rust
use winnow::error::{StrContext, StrContextValue};

alpha1
    .context(StrContext::Label("quest id"))
    .context(StrContext::Expected(StrContextValue::Description("alphabetic identifier")))
    .parse_next(input)
```

### Converting Errors for Application Use

Use `Parser::parse` (not `parse_next`) at the top-level entry point. It:
1. Verifies all input was consumed (checks for `eof`).
2. Wraps errors in `ParseError` which includes the original input and failure offset.
3. Converts from `ModalResult` to standard `Result` if needed.

```rust
use winnow::Parser;
use winnow::error::ParseError;

fn compile_file(source: &str) -> anyhow::Result<PluginData> {
    parse_document
        .parse(source)
        .map_err(|e: ParseError<&str, ContextError>| {
            anyhow::anyhow!("parse error at offset {}: {}", e.offset(), e.inner())
        })
}
```

---

## Application Integration

### Bridging `winnow::Result` → `anyhow::Result`

At the boundary between parsing code and application code, convert errors:

```rust
impl std::str::FromStr for DialogueFile {
    type Err = anyhow::Error;

    fn from_str(input: &str) -> std::result::Result<Self, Self::Err> {
        parse_dialogue_file
            .parse(input)
            .map_err(|e| anyhow::format_err!("{e}"))
    }
}
```

### Testing Parsers

For unit tests, use `parse_peek` to check what's consumed without requiring full consumption:

```rust
#[test]
fn test_parse_heading() {
    let input = "## Topic \"little advice\"\nmore stuff";
    let (remaining, output) = parse_heading.parse_peek(input).unwrap();
    assert_eq!(output, ("Topic", "little advice"));
    assert_eq!(remaining, "\nmore stuff");
}
```

For full document tests, use `.parse()`:

```rust
#[test]
fn test_full_document() {
    let input = "---\nplugin_author: \"Test\"\n---\n";
    let doc = parse_document.parse(input).unwrap();
    assert_eq!(doc.author, "Test");
}
```

---

## Patterns for This Project

This project parses markdown-like `.md` files into TES3 plugin data. Here are the specific patterns that arise.

### YAML Frontmatter

The file starts with `---\n`, then key-value pairs, then `---\n`:

```rust
fn frontmatter<'s>(input: &mut &'s str) -> Result<Vec<(&'s str, &'s str)>> {
    delimited(
        ("---", line_ending),
        repeat(0.., terminated(
            separated_pair(
                take_while(1.., |c: char| c.is_alphanumeric() || c == '_'),
                (space0, ':', space0),
                take_till(0.., ['\n', '\r']),
            ),
            line_ending,
        )),
        ("---", line_ending),
    ).parse_next(input)
}
```

### Quoted Strings

Many IDs in the spec are wrapped in double quotes:

```rust
fn quoted_string<'s>(input: &mut &'s str) -> Result<&'s str> {
    delimited('"', take_till(0.., '"'), '"').parse_next(input)
}
```

### Dialogue Block Headers

```rust
fn dialogue_header<'s>(input: &mut &'s str) -> Result<(DialogueType, &'s str)> {
    preceded(
        "## ",
        (
            alt((
                "Topic".value(DialogueType::Topic),
                "Journal".value(DialogueType::Journal),
                "Greeting".value(DialogueType::Greeting),
                "Voice".value(DialogueType::Voice),
                "Persuasion".value(DialogueType::Persuasion),
            )),
            preceded(space1, quoted_string),
        ),
    ).parse_next(input)
}
```

### Key-Value Lines

Parsing `key: value` pairs where the value extends to end-of-line:

```rust
fn key_value_line<'s>(input: &mut &'s str) -> Result<(&'s str, &'s str)> {
    terminated(
        separated_pair(
            take_while(1.., |c: char| c.is_alphanumeric() || c == '_'),
            (space0, ':', space0),
            till_line_ending,
        ),
        line_ending,
    ).parse_next(input)
}
```

### Indented Blocks (e.g. multi-line `text:` or `script_text:`)

For YAML-style `|` multi-line values, consume all following indented lines:

```rust
fn multiline_value<'s>(input: &mut &'s str) -> Result<&'s str> {
    preceded(
        ('|', line_ending),
        repeat::<_, _, (), _, _>(
            1..,
            (space1, till_line_ending, line_ending),
        ).take(),
    ).parse_next(input)
}
```

### Numeric Fields

```rust
fn parse_disposition(input: &mut &str) -> Result<i32> {
    dec_int.parse_next(input)
}

fn parse_filter_index(input: &mut &str) -> Result<u8> {
    dec_uint.parse_next(input)
}
```

### Comparison Operators

```rust
#[derive(Debug, Clone, Copy)]
enum Comparison { Equal, NotEqual, Greater, GreaterEqual, Less, LessEqual }

fn parse_comparison(input: &mut &str) -> Result<Comparison> {
    alt((
        ">=".value(Comparison::GreaterEqual),
        "<=".value(Comparison::LessEqual),
        "!=".value(Comparison::NotEqual),
        "==".value(Comparison::Equal),
        ">".value(Comparison::Greater),
        "<".value(Comparison::Less),
    )).parse_next(input)
}
```

Note: multi-character operators (`>=`, `<=`, `!=`, `==`) are listed **before** their single-character prefixes (`>`, `<`). `alt` tries alternatives in order and returns the first match.

### Building Structs with `seq!`

```rust
use winnow::combinator::seq;

fn parse_filter(input: &mut &str) -> Result<Filter> {
    seq!(Filter {
        _: (space0, "- index:", space0),
        index: dec_uint,
        _: line_ending,
        _: (space0, "type:", space0),
        filter_type: parse_filter_type,
        _: line_ending,
        // ... additional fields ...
    }).parse_next(input)
}
```

---

## Quick Reference Card

| Want to... | Use |
|---|---|
| Match exact text | `"literal"` or `'c'` |
| Match one of several chars | `one_of(['a', 'b'])` or `one_of('0'..='9')` |
| Take N chars | `take(N)` |
| Take while condition | `take_while(1.., \|c: char\| ...)` |
| Take until literal | `take_until(0.., "end")` |
| Sequence parsers | `(p1, p2, p3)` tuple |
| Sequence with struct | `seq!(Struct { field: parser, ... })` |
| Try alternatives | `alt((p1, p2, p3))` |
| Match-like dispatch | `dispatch!(prefix_parser; "a" => p1, "b" => p2, _ => fail)` |
| Make optional | `opt(parser)` → `Option<O>` |
| Repeat into Vec | `repeat(0.., parser)` |
| Repeat with separator | `separated(0.., parser, ",")` |
| Discard prefix | `preceded(prefix, body)` |
| Discard suffix | `terminated(body, suffix)` |
| Discard both wrappers | `delimited(open, body, close)` |
| Parse text to number | `digit1.parse_to::<u32>()` or `dec_uint` |
| Transform output | `.map(\|x\| ...)` |
| Replace output | `.value(constant)` |
| Validate output | `.verify(\|x\| condition)` |
| Capture consumed span | `.take()` |
| Add error context | `.context(StrContext::Label("..."))` |
| Commit (no backtrack) | `cut_err(parser)` |
| Top-level parse | `parser.parse(full_input)` |
| Test a parser | `parser.parse_peek(input)` → `(remaining, output)` |
