---
Source:
Type: Greeting
Topic: Greeting 1
DiagID: 3211212001225032000
PrevID: 30616697226936916
Disposition: 0
ID: ABtv_Talk_DwPrintMach
Race:
Sex:
Class:
Faction:
Rank:
Cell:
PC Faction:
PC Rank:
Result: |
  Player->RemoveItem "Misc_SoulGem_Grand" 1
  Player->RemoveItem "AB_Misc_InkVial" 1
  Player->RemoveItem "AB_sc_Blank" 1
  Set ABtv_DwPrintMachineState to 8
  Goodbye
Function0: Function
Variable0: Choice = 8
Function1: Item
Variable1: Misc_SoulGem_Grand >= 1
---

The machine begins to whir...