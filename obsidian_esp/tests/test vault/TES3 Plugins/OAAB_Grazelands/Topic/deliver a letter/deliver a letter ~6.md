---
Source:
Type: Topic
Topic: deliver a letter
DiagID: 2578895273057129984
PrevID: 145049576358222179
Disposition: 0
ID: galos mathendis
Race:
Sex:
Class:
Faction:
Rank:
Cell:
PC Faction:
PC Rank:
Result: |
  Player->Additem "ABtv_note_GalosToMilyn" 1
  Journal OAAB_TVos_GalosLetter 10
Function0: Journal
Variable0: OAAB_TVos_GalosLesson >= 100
Function1: Function
Variable1: Choice = 1
Function2: Journal
Variable2: OAAB_TVos_GalosLetter = 0
canvas:
  - "[[Enchanted Quill Acquaintances.canvas]]"
---


Thank you, %PCName. You've been invaluable in assisting with my research. Here is the letter. Encoded of course -- I've learned a thing or two from Aryon, you see. ^obsidian-esp-canvas-776731afe1