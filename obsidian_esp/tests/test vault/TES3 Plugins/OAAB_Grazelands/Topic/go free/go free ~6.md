---
Source:
Type: Topic
Topic: go free
DiagID: 53965302313514668
PrevID: 3177419272977015760
Disposition: 0
ID: Dro'zharim
Race:
Sex:
Class: Slave
Faction:
Rank:
Cell:
PC Faction:
PC Rank:
Result: |
  Set slaveStatus to 3
  SetSpeed 46
  Set FreedSlavesCounter to FreedSlavesCounter + 1
  ModDisposition 50
  Journal "OAAB_TVos_VaroRats" 120
  AddTopic "little secret"
Function0: Function
Variable0: Choice = 1
canvas:
  - "[[Rats in Varo Tradehouse.canvas]]"
---


Yes, now %Name is free. Thanks is not enough, but %Name knows a [[little secret]] which good friend, %PCName may wish to know. ^obsidian-esp-canvas-5d66c7e56a