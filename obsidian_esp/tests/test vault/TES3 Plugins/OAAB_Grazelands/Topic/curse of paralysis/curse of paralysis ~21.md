---
Source:
Type: Topic
Topic: curse of paralysis
DiagID: 1173351511743715363
PrevID: 2842812581973316331
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
  Player->AddItem "gold_001" 75
  PlaySound "potion success"
  Player->RemoveItem "ABtv_pot_CureParalysis" 1
  Journal OAAB_TVos_MoraTrader 100
  goodbye
Function0: Journal
Variable0: OAAB_TVos_MoraTrader = 40
Function1: Item
Variable1: ABtv_pot_CureParalysis >= 1
Function2: Function
Variable2: Choice = 420
canvas:
  - "[[A Smidge Too Far.canvas]]"
---


Ah, thank you, %PCName. You have no idea how good this feels. Here, take this as payment. And yes, I will go to [[work]] at this tradehouse. I don't know if it will last, but I'll give it a shot. ^obsidian-esp-canvas-1506b9e0a2