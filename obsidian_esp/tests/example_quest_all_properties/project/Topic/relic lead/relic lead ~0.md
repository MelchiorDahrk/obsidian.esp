---
Type: Topic
Topic: relic lead
DiagID: 4004004000
PrevID:
ID: Aumsi
Disposition: 40
Race: Breton
Sex: Female
Class: Agent
Faction: Blades
Rank: Rank 1
Cell: Ald Daedroth
PC Faction: Blades
PC Rank: Rank 0
Result: |
  AddTopic "relic proof"
  Journal "aa_example_reliquary" 20
Function0: Function
Variable0: PcLevel >= 1
Function1: Global
Variable1: GameHour >= 0
Function2: Local
Variable2: aa_example_local >= 0
Function3: Journal
Variable3: aa_example_reliquary >= 10
Function4: Item
Variable4: aa_example_missing_item >= 1
Function5: Dead
Variable5: aa_example_missing_actor = 0
---
The key was traded to a smuggler who hid it behind a loose stone in the shrine cellar.
