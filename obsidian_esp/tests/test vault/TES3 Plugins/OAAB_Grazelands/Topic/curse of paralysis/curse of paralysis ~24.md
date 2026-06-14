---
Source:
Type: Topic
Topic: curse of paralysis
DiagID: 257396551315418199
PrevID: 24012172712424219841
Disposition: 0
ID: ABtv_TelMoraTrader
Race:
Sex:
Class:
Faction:
Rank:
Cell:
PC Faction:
PC Rank:
Result: |
  MessageBox "[You pour the contents of the potion into the Breton's mouth and he regains motion.]"
  RemoveSpell "ABtv_cu_Paralysis"
  Player->RemoveItem "gold_001" 100
  PlaySound "potion success"
  Player->RemoveItem "ABtv_pot_CureParalysis" 1
  Journal OAAB_TVos_MoraTrader 100
  goodbye
Function0: Journal
Variable0: OAAB_TVos_MoraTrader = 91
Function1: Item
Variable1: ABtv_pot_CureParalysis >= 1
Function2: Item
Variable2: Gold_001 >= 110
canvas:
  - "[[A Smidge Too Far.canvas]]"
---


Pleasure doing [[business]] with you, %PCName. I'll go to the tradehouse after you give me the [[potion]]... ^obsidian-esp-canvas-2eb8362105