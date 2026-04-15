---
Source:
Type: Topic
Topic: restorative supplies
DiagID: 2344821756424325623
PrevID: 27948196842032030701
Disposition: 0
ID: milar maryon
Race:
Sex:
Class:
Faction:
Rank:
Cell:
PC Faction:
PC Rank:
Result: |
  Player->RemoveItem "ingred_bloat_01" 5
  Player->RemoveItem "ingred_scrib_jelly_01" 5
  Choice "I'd like to learn about restoration and your healing spell, Milar." 6 "I'll take the supplies, thank you." 7
Function0: Journal
Variable0: OAAB_TVos_SmokeskinWillpower >= 10
Function1: Journal
Variable1: OAAB_TVos_SmokeskinWillpower < 100
Function2: Item
Variable2: ingred_bloat_01 >= 5
Function3: Item
Variable3: ingred_scrib_jelly_01 >= 5
Function4: Function
Variable4: Choice = 4
---

Excellent! Thank you for your help, %PCName! This is enough to make all the [[potions]] I [[need]] for a while. As a [[reward]], I'll give you a choice: I can teach you some things about [[restoration]] and show you a cheap spell of healing that I created or I can give you a package of [[restorative supplies]] from my stock.