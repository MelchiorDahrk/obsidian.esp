---
Source:
Type: Topic
Topic: curse of paralysis
DiagID: 2770929613104632233
PrevID: 257396551315418199
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
Variable0: OAAB_TVos_MoraTrader = 40
Function1: Item
Variable1: ABtv_pot_CureParalysis >= 1
Function2: Function
Variable2: Choice = 110
Function3: Item
Variable3: Gold_001 >= 100
canvas:
  - "[[A Smidge Too Far.canvas]]"
---


Pleasure doing [[business]] with you, %PCName. I'll go to the tradehouse after you give me the [[potion]]... ^obsidian-esp-canvas-f649f5d479