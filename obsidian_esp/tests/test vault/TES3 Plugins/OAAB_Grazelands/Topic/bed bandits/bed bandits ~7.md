---
Source:
Type: Topic
Topic: bed bandits
DiagID: 3172020480190867257
PrevID: 2664223995139442921
Disposition: 0
ID: menus felas
Race:
Sex:
Class:
Faction:
Rank:
Cell:
PC Faction:
PC Rank:
Result: |
  Set ABtv_NoticeBedBandits to -1
  Player->AddItem AB_Misc_PurseCoin 1
  ModDisposition -100
  Goodbye
Function0: Global
Variable0: ABtv_NoticeBedBandits = 1
Function1: Function
Variable1: Choice = 3
Function2: Function
Variable2: PcSpeechcraft >= 75
---

What? Please don't hurt me! Here, take this and leave!