---
Source:
Type: Greeting
Topic: Greeting 1
DiagID: 3096031563334322368
PrevID: 212663489318751125
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
  Player->RemoveItem "Misc_SoulGem_Greater" 1
  Player->RemoveItem "AB_Misc_InkVial" 1
  Player->RemoveItem "AB_sc_Blank" 1
  Set ABtv_DwPrintMachineState to 4
  Goodbye
Function0: Function
Variable0: Choice = 4
Function1: Item
Variable1: Misc_SoulGem_Greater >= 1
---

The machine begins to whir...