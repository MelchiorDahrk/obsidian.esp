---
Source:
Type: Topic
Topic: do business
DiagID: 356294523101227357
PrevID: 17125488453610308
Disposition: 0
ID: ABtv_FalviloHlaaluAgent
Race:
Sex:
Class:
Faction:
Rank:
Cell:
PC Faction:
PC Rank:
Result: |
  Set ABtv_HlaaluEbonyStart to 1
  Set ABtv_HlaaluEbony to 5
  Choice "[500 Gold] 5 pieces" 5 "[400 Gold] 4 pieces" 4 "[300 Gold] 3 pieces" 3 "[200 Gold] 2 pieces" 2 "[100 Gold] 1 piece" 1 "Nevermind" 100
Function0: Function
Variable0: Choice = 30
Function1: Global
Variable1: ABtv_HlaaluEbonyStart = 0
Function2: Global
Variable2: ABtv_HlaaluEbony < 5
---

You've got a keen ear for doing [[business]], %PCName. I can only spare 5 pieces per week. But at this price, you can't go wrong!