# Obsidian Bases Syntax Examples

This reference provides complete examples of `.base` files and common YAML patterns for use in **Obsidian Bases**.

## Basic Example
A simple table view for all notes tagged `#book`.

```yaml
filters:
  and:
    - file.hasTag("book")
views:
  - type: table
    name: "Books"
    order:
      - file.name
      - rating
```

---

## Complex Filter Example
Shows notes that are either tagged `#project` OR in the `Projects` folder, but NOT marked as `done`.

```yaml
filters:
  and:
    - not:
        - status == "done"
    - or:
        - file.hasTag("project")
        - file.inFolder("Projects")
views:
  - type: table
    name: "Active Projects"
```

---

## Formula Property Example
Calculates progress and formats a price with currency.

```yaml
formulas:
  progress_pct: 'if(tasks_total, (tasks_done / tasks_total) * 100, 0)'
  price_fmt: 'if(price, "$" + price.toFixed(2), "N/A")'
properties:
  formula.progress_pct:
    displayName: "Progress"
  formula.price_fmt:
    displayName: "Price"
views:
  - type: table
    name: "Budget Overview"
    order:
      - file.name
      - formula.price_fmt
      - formula.progress_pct
    summaries:
      formula.price_fmt: Sum
```

---

## Map View Example
Configures markers with coordinates, icons, and colors. Requires the Maps plugin.

```yaml
filters:
  and:
    - file.hasTag("places")
views:
  - type: map
    name: "World Map"
    markerCoordinates: coordinates
    markerIcon: icon
    markerColor: color
    background:
      mapTiles: "https://tiles.openfreemap.org/styles/liberty"
```

---

## Cards View Example
A gallery of images from a specific property.

```yaml
filters:
  and:
    - file.hasTag("inspiration")
views:
  - type: cards
    name: "Inspiration Gallery"
    cardSize: 200
    imageProperty: cover
    imageFit: cover
    imageAspectRatio: 1.5
```

---

## List View Example
A bulleted list with indented properties.

```yaml
filters:
  and:
    - file.inFolder("Daily Notes")
views:
  - type: list
    name: "Notes"
    markers: bullets
    indentProperties: true
```

---

## Summary Examples
Using custom aggregation formulas.

```yaml
summaries:
  avg_rating: 'values.mean().round(2)'
views:
  - type: table
    name: "Rated Items"
    summaries:
      rating: "avg_rating"
```

---

## Contextual `this` Example
A sidebar view that shows all notes linking to the current active file.

```yaml
filters:
  and:
    - file.hasLink(this.file)
views:
  - type: table
    name: "Backlinks"
```
