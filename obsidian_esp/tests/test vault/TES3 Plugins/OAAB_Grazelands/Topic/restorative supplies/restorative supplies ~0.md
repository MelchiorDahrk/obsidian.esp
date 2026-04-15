---
Source:
Type: Topic
Topic: restorative supplies
DiagID: 2594320111712520770
PrevID:
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
  Player->AddSpell "ABtv_sp_MilarHeal"
  Player->ModRestoration 1
  ModDisposition 50
  MessageBox "You learned to cast Milar's Mending."
  MessageBox "Your Restoration skill has increased by 1."
  Journal OAAB_TVos_SmokeskinWillpower 100
Function0: Journal
Variable0: OAAB_TVos_SmokeskinWillpower >= 10
Function1: Journal
Variable1: OAAB_TVos_SmokeskinWillpower < 100
Function2: Function
Variable2: Choice = 6
---

Wonderful. It's fairly simple, really. [Milar teaches you a self-healing spell and you feel your grasp of [[restoration]] increase.] You have natural talent! May you walk in [[health]] and [[security]], friend.