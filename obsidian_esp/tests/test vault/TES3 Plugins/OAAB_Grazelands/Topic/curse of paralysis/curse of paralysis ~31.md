---
Source:
Type: Topic
Topic: curse of paralysis
DiagID: 7193304481948830534
PrevID: 115661322386823561
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
  ModDisposition -20
  goodbye
Function0: Journal
Variable0: OAAB_TVos_MoraTrader = 40
Function1: Item
Variable1: ABtv_pot_CureParalysis >= 1
Function2: Function
Variable2: PcStrength >= 60
Function3: Function
Variable3: Choice = 12
---

No, please! Okay, okay, I'll go to this tradehouse, just calm down and give me the [[potion]]...