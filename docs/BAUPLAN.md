# Bauplan für Workflow-Vorlagen

`elo_workflow_export` liefert eine Vorlage als JSON-Bauplan, `elo_workflow_build` legt aus einem Bauplan eine Vorlage an oder ersetzt eine vorhandene. Der übliche Ablauf:

1. Vorlage exportieren: `elo_workflow_export` mit `vorlage` = ID oder exakter Name.
2. Bauplan ändern (lassen), z. B. „füge nach der Prüfung einen zweiten Prüfer parallel ein".
3. `elo_workflow_build` mit `bauplan` und `vorlageId` aufrufen. Die Vorschau zeigt Prüfergebnis und Änderungsliste (neue, entfernte, geänderte Knoten und Kanten).
4. Nach Zustimmung denselben Aufruf mit `token` wiederholen. Vorher und nachher legt der Server eine Sicherung `.ewf` unter `%LOCALAPPDATA%\elo-mcp\sicherung` ab.

Ohne `vorlageId` wird eine neue Vorlage angelegt. Gibt es schon eine mit dem Namen, lehnt der Server ab.

## Aufbau

```json
{
  "name": "Rechnungsprüfung",
  "nodes": [
    { "id": 0, "type": 1, "name": "Start", "x": 100, "y": 50 },
    { "id": 1, "type": 3, "name": "Verteilen", "x": 100, "y": 150 },
    { "id": 2, "type": 2, "name": "Fachlich prüfen", "user": "Einkauf", "form": "[rechnung(kopf,pruefung)]", "timeLimitDays": 3, "x": 0, "y": 250 },
    { "id": 3, "type": 2, "name": "Sachlich prüfen", "user": "Buchhaltung", "timeLimitDays": 3, "escalateTo": ["Buchhaltung Leitung", 42], "x": 200, "y": 250 },
    { "id": 4, "type": 5, "name": "Beide fertig", "dones": 2, "x": 100, "y": 350 },
    { "id": 5, "type": 4, "name": "Freigegeben?", "cond": "ELO_WF_STATUS=TRUE", "x": 100, "y": 450 },
    { "id": 6, "type": 2, "name": "Klären", "user": "Eigentümer", "userId": -2, "x": 250, "y": 550 },
    { "id": 9, "type": 6, "name": "Ende", "x": 100, "y": 650 }
  ],
  "assocs": [[0, 1], [1, 2], [1, 3], [2, 4], [3, 4], [4, 5], [5, 9, "ja"], [5, 6, "nein"], [6, 9]]
}
```

### Knoten

| Feld | Bedeutung |
|---|---|
| `id` | ganze Zahl 0–999, eindeutig. Beim Ersetzen werden Knoten mit gleicher ID **und** gleichem Typ weiterverwendet, damit Eigenschaften außerhalb des Bauplans (z. B. aus dem Designer) bleiben |
| `type` | 1 Start, 2 Person, 3 Verteiler, 4 Entscheidung, 5 Sammler, 6 Ende. Andere Typen (Zyklus, Serverübergabe, Subworkflow) lassen sich exportieren, aber nicht bauen |
| `name`, `label`, `comment` | Name, Beschriftung, Kommentar |
| `user`, `userId` | Bearbeiter eines Personenknotens (Benutzer oder Gruppe). Fehlt `userId`, sucht der Server sie zum Namen. Sonderwerte: `-2` Eigentümer, `-3` ignorieren, `-4` Vorgesetzter. Der Startknoten bekommt immer den Eigentümer |
| `form` | Formular im Muster `[name(seite1,seite2)]`. Das Formular muss unter `Administration/ELOwf Base/Forms` liegen |
| `onEnter`, `onExit` | Start- und Ende-Skript. An Verteilern erwartet der Server einen Funktionsbaustein `sol.*` (sonst Warnung) |
| `props` | Knoteneigenschaften als JSON-Objekt (z. B. die Konfiguration eines `sol.*`-Bausteins) oder als Text |
| `cond` | Bedingung einer Entscheidung, Syntax wie im Workflowdesigner, z. B. `ELO_WF_STATUS=TRUE` |
| `timeLimitDays` | Frist in Arbeitstagen |
| `escalateTo` | `[name, id]` der ersten Eskalationsstufe, nur zusammen mit `timeLimitDays`. Weitere Stufen stehen nicht im Bauplan |
| `flags` | weitere Knoten-Flags (`WFNodeC.FLAG_*`), wie exportiert |
| `dones` | Zähler eines Sammlers: so viele Vorgänger müssen fertig sein |
| `x`, `y` | Position im Designer |

### Kanten

`[von, nach]` oder an Entscheidungen `[von, nach, "ja"]` bzw. `[von, nach, "nein"]`.

## Prüfungen

Fehler verhindern das Bauen, Warnungen stehen in der Vorschau.

| Prüfung | Art |
|---|---|
| genau ein Start, mindestens ein Ende | Fehler |
| Knoten-IDs gültig und eindeutig, nur Typen 1–6, jeder Knoten hat einen Namen | Fehler |
| Kanten zeigen auf vorhandene Knoten, dritter Wert nur `ja`/`nein` | Fehler |
| jeder Knoten außer Ende hat einen Nachfolger | Fehler (der Vorgang bliebe dort hängen) |
| von jedem erreichbaren Knoten führt ein Weg zu einem Ende | Fehler |
| Knoten vom Start aus nicht erreichbar | Warnung |
| Entscheidung ohne Bedingung | Fehler |
| Entscheidung ohne ja- oder nein-Kante, Entscheidung direkt am Sammler | Warnung |
| Sammler ohne `dones` oder mit 0 | Fehler (ELO leitet sonst beim ersten fertigen Vorgänger weiter) |
| Sammler mit `dones: -1` | Warnung (wartet auch auf Zweige, die ein IF übersprungen hat, und bleibt stehen) |
| `dones` größer als die Zahl der Vorgänger | Fehler (würde nie weiterleiten) |
| Personenknoten ohne Bearbeiter, unbekannte Benutzer-ID, Eskalation an unbekannte ID | Fehler |
| Name und ID des Bearbeiters passen nicht zusammen | Warnung (die ID gilt) |
| Formular nicht gefunden oder nicht im Muster `[name(...)]` | Warnung |
| mehr als 20 Nachfolger | Fehler |

## Was beim Ersetzen gilt

- ID und Name der Vorlage bleiben. Umbenennen geht über den Bauplan nicht.
- Laufende Workflows ändern sich nicht. Sie laufen mit ihrer Kopie der alten Vorlage weiter.
- Ist die Vorlage gesperrt (z. B. offen im Designer), lehnt der Server ab.
- Neue oder geänderte Formulare sind erst nach „Aktualisieren" im Formulardesigner sichtbar.
