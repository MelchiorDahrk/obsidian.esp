---
Source:
Type: Topic
Topic: deliver a letter
DiagID: 1327467092479311072
PrevID: 1483532130207622830
Disposition: 0
ID: galos mathendis
Race:
Sex:
Class:
Faction:
Rank:
Cell:
PC Faction:
PC Rank:
Result: |
  Player->Removeitem "ABtv_Key_MilynInscribed" 1
  Player->AddItem "amulet_gem_feeding" 1
  Journal OAAB_TVos_GalosLetter 100
  Choice "Thank you." 3 "What is the key for?" 4 "Anything else you need help with?" 5
Function0: Journal
Variable0: OAAB_TVos_GalosLetter = 20
Function1: Item
Variable1: ABtv_Key_MilynInscribed >= 1
---

Oh yes, thank you! This is just what I needed. Here, I made this amulet for practice, but don't really [[need]] it. Maybe you'll have a use for it. Or sell it, I'm not sentimental.