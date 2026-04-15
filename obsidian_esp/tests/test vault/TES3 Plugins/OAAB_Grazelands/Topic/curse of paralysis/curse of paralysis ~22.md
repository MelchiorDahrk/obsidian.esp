---
Source:
Type: Topic
Topic: curse of paralysis
DiagID: 2601959112667112628
PrevID: 1173351511743715363
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
  Player->AddItem "gold_001" 50
  Journal OAAB_TVos_MoraTrader 102
Function0: Journal
Variable0: OAAB_TVos_MoraTrader = 40
Function1: Item
Variable1: ABtv_pot_CureParalysis >= 1
Function2: Function
Variable2: Choice = 410
---

Ah, thank you, %PCName. You have no idea how good this feels. I'm sorry, but I won't be going to that tradehouse. I can't stand these Telvanni. I'm taking the next boat out of here. But here, take this small payment as a sign of my gratitude.