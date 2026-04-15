---
Source:
Type: Greeting
Topic: Greeting 1
DiagID: 209523106921609540
PrevID: 899628767121412000
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
  Set ABtv_DwPrintMachineState to 6
  Goodbye
Function0: Function
Variable0: Choice = 6
Function1: Item
Variable1: Misc_SoulGem_Greater >= 1
---

The machine begins to whir...