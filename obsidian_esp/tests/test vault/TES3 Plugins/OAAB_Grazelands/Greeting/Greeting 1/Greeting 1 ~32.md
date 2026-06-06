---
Source:
Type: Greeting
Topic: Greeting 1
DiagID: 13847165201428521929
PrevID: 1121575246143740
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
  Set ABtv_DwPrintMachineState to 3
  Goodbye
Function0: Function
Variable0: Choice = 3
Function1: Item
Variable1: Misc_SoulGem_Grand >= 1
---

The machine begins to whir...