---
Source:
Type: Topic
Topic: rat catcher
DiagID: 3209043330630278
PrevID: 201324989383912320
Disposition: 0
ID: goler andrethi
Race:
Sex:
Class:
Faction:
Rank:
Cell:
PC Faction:
PC Rank:
Result: |
  Player->RemoveItem "ABtv_note_VaroSlaveContract" 1
  AddTopic "the incident"
  Choice "[Wait.]" 1
Function0: Journal
Variable0: OAAB_TVos_VaroRats = 30
Function1: Item
Variable1: ABtv_note_VaroSlaveContract >= 1
canvas:
  - "[[The Domain of Living Fire.canvas]]"
  - "[[Rats in Varo Tradehouse.canvas]]"
---



Varo informed me that he had an interest in the [[slave]] we're holding. [[Master Aryon]] isn't overly interested in keeping [[slaves]] around -- he prefers [[mercenaries]] and paid workers. But the contractor working on the tower had a few in his employ before [[the incident]]. This one was caught hoarding [[Dwemer artifacts]] unearthed during their excavation of the dungeon. Let me see the paperwork Varo sent with you. ^obsidian-esp-canvas-c27a3e0a93