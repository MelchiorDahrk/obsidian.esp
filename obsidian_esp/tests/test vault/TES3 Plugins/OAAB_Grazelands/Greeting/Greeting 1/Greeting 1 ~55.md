---
Source:
Type: Greeting
Topic: Greeting 1
DiagID: 266216721839911797
PrevID: 2245450062309520279
Disposition: 0
ID: Dro'zharim
Race: Khajiit
Sex:
Class: Slave
Faction:
Rank:
Cell:
PC Faction:
PC Rank:
Result: |
  AddTopic "go free"
  Set slaveStatus to 2
  SetSpeed 300
  Choice "Not exactly..." 1 "Yes, but we can't do it here." 2
Function0: Journal
Variable0: OAAB_TVos_VaroRats = 40
Function1: Local
Variable1: slaveStatus <= 1
---

%Name saw the [[Dunmer]] give you a key. WIll you let %Name [[go free]]?