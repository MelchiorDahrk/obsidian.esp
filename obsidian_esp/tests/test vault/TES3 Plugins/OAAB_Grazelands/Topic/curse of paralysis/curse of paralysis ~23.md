---
Source:
Type: Topic
Topic: curse of paralysis
DiagID: 24012172712424219841
PrevID: 2601959112667112628
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
  PlaySound "potion success"
  Player->RemoveItem "ABtv_pot_CureParalysis" 1
  Journal OAAB_TVos_MoraTrader 100
  goodbye
Function0: Journal
Variable0: OAAB_TVos_MoraTrader = 40
Function1: Item
Variable1: ABtv_pot_CureParalysis >= 1
Function2: Function
Variable2: Choice = 400
canvas:
  - "[[A Smidge Too Far.canvas]]"
---


Ah, thank you, %PCName. You have no idea how good this feels. Yes, I will go to [[work]] at this tradehouse. I don't know if it will last, but I'll give it a shot. ^obsidian-esp-canvas-8cf34eba6f