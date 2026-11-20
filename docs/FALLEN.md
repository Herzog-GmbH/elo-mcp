# Fallen der ELO-IX-API

Was uns beim Bau dieses Servers begegnet ist, geprüft gegen einen Indexserver 25.00 mit der Java-API (`de.elo.ix.client`). Vielleicht spart es euch bei eigenen Skripten Zeit.

## Suchen

| Falle | Was stattdessen |
|---|---|
| `FindChildren` neben `findByESearch` wird **still ignoriert**. Die Suche läuft dann über das ganze Archiv. | Ordner über `DocumentOptions.setCurrentFolderId(<ordnerId>)` als `searchOptions` begrenzen. Das schließt Unterordner ein. |
| `FindByESearch` ohne `searchOptions` → `ELOIX:1000 SearchOptions is null`. Mit leerem `ESearchOptions` → `ELOIX:2000 Falscher Parameter`. | Es muss `DocumentOptions` sein. `searchIn` ist ein Bitfeld aus `ESearchParamsC` (TITLE, FULLTEXT, INDEX_FIELDS, EXTRA_TEXT, VERSION, FEED). |
| `FindChildren.endLevel = 0` wirkt wie `1`. | `1` = direkte Kinder, `2` = zwei Ebenen, `-1` = beliebig tief. Mit `findByIndex` kombiniert grenzt `FindChildren` korrekt ein. |
| Suchen ohne `findClose` lassen Suchen auf dem Server offen. | `findClose(searchId)` immer im `finally`. |
| Abfragen über alle laufenden oder beendeten Workflows (`findFirstWorkflows` mit Platzhalter) können einen Indexserver mit `OutOfMemoryError` lahmlegen. | Workflows nur zu einem Objekt (`setObjId`) oder per ID lesen. |
| `findNextSords(searchId, idx, max, sordZ)` erwartet in `idx` den **absoluten** Startindex, nicht die Seitennummer. | Für eine Seite ab `n`: `findFirstSords(fi, 1, …)`, dann `findNextSords(id, n, max, …)`; `isMoreResults` der letzten Antwort sagt, ob es weitergeht. |
| Die Trefferzahl einer Suche kommt nur mit `FindOptions.setEvalCount(true)` in `FindResult.getCount()`. | Erst zählen (eine Abfrage, Ergebnisgröße 1), dann entscheiden, ob seitenweises Lesen vertretbar ist. |

## Dokumente und Versionen

| Falle | Was stattdessen |
|---|---|
| `checkoutDoc(objIdA, docIdVonB, …)` liefert **ohne Fehler das komplette Objekt B**, Sord und Datei. | Nie eine `docId` direkt ansprechen. Immer aus der Versionsliste des eigenen Objekts wählen und `sord.id` gegenprüfen. |
| Versionsliste: Mit `docId null` kommt nur die aktuelle Version. | `checkoutDoc(objId, "-1", EditInfoC.mbSordDoc, LockC.NO)` liefert alle, neueste zuerst. Das Feld `version` ist oft leer, die Kennung ist die `docId`. |
| Weder `IDateIso` (Ablagedatum) noch `XDateIso` (Dokumentdatum) ändern sich mit einer neuen Version. | Neue Version über die aktuelle `docId` oder die `md5` der neuesten Version erkennen. |
| `checkinSord`/`checkinDocEnd` mit `LockC.YES` heißt dort „entsperren", nicht „sperren". | Zum Entsperren nach einem Fehler: `checkinSord(sord, SordC.mbOnlyUnlock, LockC.YES)`. |
| Zeitstempel der Versionen kommen in UTC. | Für die Anzeige umrechnen. |
| Die Archivwurzel (ID 1) hat einen Sondertyp ≥ 254 und gilt mit `type < 254` nicht als Ordner. | ID 1 gesondert behandeln. |

## Masken und Felder

| Falle | Was stattdessen |
|---|---|
| Stichwortlisten liefern einen Wurzeleintrag „Stichwörter für Feldgruppe …" mit. | Beim Prüfen ignorieren. |
| Einträge einer Stichwortliste brauchen IDs nach festem Schema: `<Liste>¶.AA`, `<Liste>¶.AB` …, darunter je Ebene zwei Buchstaben mehr (`<Liste>¶.AAAA`). `¶` ist U+00B6. Ein neuer `Keyword` ohne `setEnabled(true)` ist nicht wählbar. | `elo_keywords_set` vergibt die IDs und setzt neue Einträge wählbar. Höchstens 676 Einträge je Ebene (AA bis ZZ). |
| In manchen Archiven sind Datumsfelder als **Textfeld** angelegt. ELO prüft dort nichts. | Echte Datumsfelder (Typ `TYPE_ISO_DATE`) als `JJJJMMTT000000` schreiben. Für Textfelder gilt die Hausregel des Archivs, hier wählbar mit `-TextDatumJJJJMMTT`. |
| `DocMaskLine.tabIndex` ist die **Nummer** des Reiters, nicht die Reihenfolge. Die Reiternamen stehen im Maskentext, getrennt durch `\|` (`Basis\|Termine\|\|\|`). Ein Reiter ohne Namen erscheint im Client als „Index1" usw. | Reiter erst im Maskentext benennen, dann Felder darauf legen. |
| Auf Reiter 0 belegen Kurzbezeichnung, Datum und Ablagedatum die Zeilen 1 bis 3. Ein Feld in Zeile 1 bis 3 liegt über diesen Feldern. | Indexfelder auf Reiter 0 ab Zeile 4, auf anderen Reitern ab Zeile 1, fortlaufend. |
| Eine Maskenzeile **ohne Rechte** (`aclItems` leer) zeigt ihren Wert nur Administratoren. Alle anderen sehen ein leeres Feld, auch wenn der Wert gesetzt ist. | Jede Zeile bekommt Rechte, z. B. wie die übrigen Zeilen der Maske. |
| Beginnt das Eingabefeld (`editCol`) vor dem Ende der Beschriftung, liegt die Beschriftung unter dem Feld. | `editCol` mindestens 14, bei langen Beschriftungen etwa Länge − 1 (26 für „Kündigungsfrist in Monaten"). |
| Programme, die Felder nach Position auswerten (z. B. der Maskenbaustein von ACTIWARE BLP), greifen nach dem Umsortieren der Zeilen auf falsche Felder. | Neue Felder nur hinten anhängen. Für eine andere Anzeige nur Reiter, Zeile und Spalte ändern, nicht die Reihenfolge. |
| Klammern im Anzeigenamen stören Platzhalter wie `[NDF.<Name>]`: `(` startet dort eine Formatangabe. | Anzeigenamen ohne Klammern. |
| Zeilen-IDs 50 bis 59 sind für ELO-Systemfelder reserviert (`ELO_XLINK`, `ELO_FNAME` …), mehr als 199 geht nicht. | Neue IDs nach der höchsten vergeben und 50 bis 59 überspringen. |
| Eine geänderte Maske sieht der ELO Client erst nach einer Neuanmeldung. | Nach dem Speichern zurücklesen und vergleichen, im Client neu anmelden. |

## Notizen, Map-Felder und Feed

| Falle | Was stattdessen |
|---|---|
| `Note.desc` enthält bei Text- und Stempelnotizen vor dem Text einen Vorspann fester Länge, z. B. `9+F70505FA0360Calibri …`: 2 Zeichen Kennung, Schrifthöhe (2 hex), Farbe (6 hex), Winkel (4 Ziffern), Schriftname auf 32 Zeichen aufgefüllt, zusammen 46 Zeichen. | `note.getNoteText().getText()` liefert den Text ohne Vorspann, `getFontInfo()` die Schrift. Fehlt `noteText`, die ersten 46 Zeichen abschneiden. |
| In Stempeln steht der Zeilenwechsel als die zwei Zeichen `\n`, nicht als Zeilenende. | Nur bei Stempeln umwandeln, in anderen Notizen kann `\n` Teil des Textes sein (Pfad). |
| Die Art einer Notiz ist nur eine Nummer (`Note.type`): 1 bis 3 Haftnotizen, ab 10 Anmerkungen auf der Seite, z. B. 20 Textnotiz (`TYPE_ANNOTATION_NOTE_WITHFONT`) und 23 Stempel (`TYPE_ANNOTATION_STAMP_NEW`). | Die Namen stehen als Konstanten in `NoteC`; per Reflection lesen, dann passt es auch zu anderen IX-Versionen. |
| Stempel und Notizen liegen auf dem Bild. Die Suche findet sie nicht, und in keinem Feld steht, wer wann gestempelt hat. | Je Dokument mit `checkoutNotes(objId, null, NoteC.mbAll, LockC.NO)` lesen (`elo_notes`). Für Auswertbares Felder, Map-Felder oder den Feed nehmen. |
| `checkinMap(domain, id, objId, KeyValue[], lock)` will die Objekt-ID zweimal, einmal als Text und einmal als Zahl. Es ändert nur die übergebenen Schlüssel, eine Prüfung gegen eine Maske gibt es nicht: Ein Tippfehler legt still einen neuen Schlüssel an. Ein leerer Wert entfernt den Eintrag ganz. | Vorher mit `checkoutMap` lesen, neue Schlüssel und eine andere Groß-/Kleinschreibung in der Vorschau melden (`elo_map_set`). |
| Die Map eines Vorgangs liegt in einem eigenen Bereich, nicht am Objekt. | `checkoutMap(MapDomainC.DOMAIN_WORKFLOW_ACTIVE, <Workflow-ID>, null, LockC.NO)`, für beendete `DOMAIN_WORKFLOW_FINISHED` (`elo_map` mit `workflow`). Schreiben mit `checkinMap(DOMAIN_WORKFLOW_ACTIVE, <Workflow-ID>, <Objekt-ID des Vorgangs>, …)` (`elo_map_set` mit `workflow`). |
| Den Feed liefert nicht der Indexserver-Dienst selbst, sondern `conn.getFeedService()`. Gesucht wird über `FindActionsInfo.setObjId(<Objekt-ID>)`, das Ergebnis steht in `FindResult.getActions()`, neueste zuerst. | `findFirstActions(info, max, ActionC.mbAll)` mit Obergrenze, danach `ix().findClose(searchId)`. `setActionTypes` grenzt schon auf dem Server ein. |
| Automatische Feed-Einträge (`EActionType.AutoComment`, z. B. aus Workflow-Skripten) tragen keinen Text, sondern ein JSON mit Sprachdatei, Schlüssel und Daten (`{"file": …, "key": …, "data": […]}`). Der angezeigte Wortlaut steht nur in der Sprachdatei auf dem Server. | Schlüssel und Daten auswerten, nicht nach dem Wortlaut suchen. |
| Ein Kommentar im Feed braucht die **GUID** des Objekts, nicht die ID, und entsteht in zwei Schritten. Die Zeitstempel im Feed kommen in UTC. | `createAction(EActionType.UserComment, <Objekt-GUID>)`, `setText(…)`, dann `checkinAction(action, ActionC.mbAll)`; das liefert die GUID des Eintrags zum Zurücklesen. |
| Erwähnungen stehen im Kommentartext als `@[Name (GUID)]` und lösen eine Benachrichtigung aus. | Beim Lesen auf `@Name` kürzen; beim Schreiben in der Vorschau darauf hinweisen. |
| In Map-Feldern stehen auch Passwörter, die ein Formular abfragt. | Schlüssel, die auf `_PW` enden oder nach Passwort oder Token aussehen, nicht ausgeben und nicht über die API setzen. |

## Farben, registrierte Funktionen, ELOwf

| Falle | Was stattdessen |
|---|---|
| Die Farbe eines Objekts ist nur eine Nummer (`Sord.kind`). In ELO 25 heißen die Standardfarben `ELO.COLOR.RED` usw., der Anzeigename („Rot“) hängt an der Sprache. Alte Vorlagen und Skripte nennen andere Namen; eigene Farben (Business Solutions, von Hand angelegt) haben nur einen Namen, und zwei Farben können gleich angezeigt werden (z. B. „Gelb“ als eigene Farbe und als `ELO.COLOR.YELLOW`). | Die Liste mit `checkoutColors(LockC.NO)` lesen und nach ID, Name, Kurzname (`getSpecName`) oder Anzeigename (`getDisplayName`) suchen; mehrdeutige Namen ablehnen, in der Vorschau ID und Name zeigen (`elo_colors`, `elo_color_set`). Farb-IDs zwischen zwei Archiven vergleichen, bevor ein Skript sie fest einträgt. |
| `ColorData.getRGB()` ist ein Windows-`COLORREF` (`0x00BBGGRR`), kein `#RRGGBB`. | Bytes tauschen: Rot ist das niedrigste Byte. |
| Nur die Farbe ändern: `checkinSord(sord, SordC.mbAll, …)` schreibt das ganze Objekt zurück. | `new SordZ(SordC.mbKind)` als Auswahl, Objekt vorher sperren (`LockC.YES`). Setzt ein Workflow die Farbe als Status, überschreibt er sie beim nächsten Schritt. |
| Einer registrierten Funktion (`executeRegisteredFunction`) sieht man nicht an, ob sie schreibt; viele laufen mit Adminrechten (`ixConnectAdmin`). | Ohne Freigabe nur eine feste Liste lesender Funktionen mit Grenzen für die Abfrage (`elo_function_read`), alles andere zweistufig mit Vorschau (`elo_function_call`). Business-Solutions-Funktionen nehmen ein `Any` vom Typ `TYPE_STRING` mit JSON. |
| `RF_sol_common_service_SordProvider` sucht mit `masks` und `search` über ganze Masken; ohne `options.maxResults` liefert er viel. | Immer eine Maske, ein Suchfeld und `maxResults` mitgeben. |
| ELOwf liest die Formularliste nur beim Start. Neue Formulare liefern bis dahin 404, ein geänderter gemeinsamer Rahmen kommt nicht an. | `edit.jsp?reload=1&ticket=<Ticket>` aufrufen, wie „Aktualisieren“ im Formulardesigner, ohne Umleitungen zu folgen (eine Umleitung heißt: zur Anmeldung). Das Ticket nur an den Server des Indexservers geben und aus Antworten und Fehlermeldungen tilgen (`elo_form_reload`). |
| Eine Gruppenaufgabe muss erst angenommen werden: Das Formular zeigt vorher keine Knöpfe, und ELO 25 leitet sie über die API laut IX-Log nicht weiter. | Annehmen: `takeWorkFlowNode(flowId, nodeId, null, WFTakeNodeC.DEFAULT, LockC.NO)`, danach steht das eigene Konto am Knoten. Die Gruppe steht dann nur noch als Bearbeiter der Vorlage in `designDepartment`; `department2` bleibt -1, und `RESET_DEPARTMENT2` ändert nichts. Zurückgeben: `takeWorkFlowNode(flowId, nodeId, "<Gruppen-ID>", WFTakeNodeC.RESET_IN_USE_DATE, LockC.NO)` (`elo_task_take`, `elo_forward_task` mit `annehmen`). `inUseDate` zeigt nicht verlässlich, ob angenommen wurde. |

## Rechte und Anmeldung

| Falle | Was stattdessen |
|---|---|
| `UserInfo.flags`/`flags2` enthalten nur die **direkt** vergebenen Rechte. | Wirksame Rechte = eigene Flags ODER Flags aller Gruppen aus `groupList`, auch verschachtelt. |
| `IXConnFactory.create(user, pwd, host, runAsUser)` wird für normale Konten mit `ELOIX:3008 Unbekannter Benutzer, falsches Passwort oder Konto gesperrt` abgelehnt, sogar für das eigene Konto. Zählt als Fehlanmeldung. | Run-As geht nur mit einem Dienstkonto, das in ELO direkt Hauptadministrator ist. Ohne so ein Konto meldet sich jede Person selbst an, wie bei diesem Server. Fehlgeschlagene Anmeldungen nicht automatisch wiederholen. |
| `ELOIX:3008` verrät den Grund nicht. Ist ELO an ein Active Directory angebunden, prüft der Indexserver Passwortanmeldungen dort; reine ELO-Konten ohne AD-Konto scheitern dann, ebenso als Run-As-Ziel. | Den Grund zeigt nur das Log des Indexservers. Dienstkonto und Zielbenutzer als AD-Konten anlegen. |
| Ohne `System.exit(0)` hält die IX-Verbindung die JVM noch über eine Minute am Leben. | Am Ende abmelden und `System.exit(0)`. |
| Eine Vertretung gibt dem Vertreter nur die Aufgaben (und auf Wunsch die Postbox), keine Objektrechte. Ein Knopf (Action Definition) oder Ordner, den nur die vertretene Person sieht, bleibt für den Vertreter unsichtbar. | Mit `elo_acl` beide Personen vergleichen (`unterordner=true` für eine Ordnerebene), fehlende Einträge mit `elo_acl_set` und `wie` nachziehen. |
| `deactivateSubstitution` lehnt ELO bei zeitgesteuerten Vertretungen mit `ELOIX:5071` ab, es geht nur bei von Hand aktivierten. | Zum Beenden den Zeitraum kürzen (`checkoutSubstitutions` mit Sperre, Perioden ändern, `checkinSubstitutions`). |
| Vertretungszeiträume gelten tageweise. Ein Ende „heute, jetzt" läuft bis Tagesende weiter. | Ende auf gestern 23:59:59 setzen; ein Zeitraum, der heute beginnt, muss ganz weg. |
| Ein ACL-Eintrag vom Typ 100 (erben) bedeutet: Rechte des Elternordners, begrenzt durch die Bits dieses Eintrags. Typ 200 gilt nur für den Eigentümer, Typ 10 sind Schlüssel. | Wirksame Rechte rekursiv über den Elternordner rechnen; Schlüssel nicht raten, sondern melden. |

## Workflows

| Falle | Was stattdessen |
|---|---|
| Sammelknoten mit Zähler 0 leiten schon beim ersten fertigen Vorgänger weiter. Mit -1 warten sie auch auf Zweige, die ein IF übersprungen hat, und bleiben stehen. | Festen Zähler = Zahl der Zweige. Statt Entscheidung direkt am Sammler einen leeren Verteiler „Übersprungen" dazwischen. |
| Ein Personenknoten ohne ausgehende Kante lässt den Vorgang hängen. | Vor dem Speichern prüfen, dass jeder Knoten außer Ende einen Nachfolger hat. |
| Weiterleiten über die API (`forwardWorkflowNode`) übergeht die Prüfungen eines Formulars am Knoten. | Bei Knoten mit Formular nur bewusst über die API weiterleiten. |
| Laufende Workflows haben ihre eigene Kopie der Vorlage. | Änderungen an der Vorlage wirken nur auf neue Vorgänge. Laufende gezielt mit `elo_workflow_node_set` bzw. `elo_workflow_edges` und `art: "aktiv"` nachziehen. |
| Ein Sammelknoten lässt sich nicht weiterleiten (`ELOIX:2000` „is not a person node"). Hängt er, weil ein Zweig nie betreten wurde, kommt der Vorgang nicht weiter. | Über `checkinWorkFlow` den Sammler verlassen (Austritt, `isNext` 0, Kante erledigt) und den Nachfolger betreten (Eintritt, `isNext` 1): `elo_workflow_activate` mit `sammler`. Der Knoten erscheint dann als Aufgabe und läuft normal weiter; Skripte am Knoten laufen dabei nicht. |
| Ein Warte- bzw. Verteilerknoten mit `wait`/`passOn` stößt nur den ersten Nachfolger an. | Die übrigen Zweige mit `elo_workflow_activate` nachziehen. |
| Nach einem Fehler mit `checkinWorkFlow(…, mbAll, …)` entsperrt, landen halb geänderte Knoten im Archiv. | Zum Entsperren nur `WFDiagramC.mbOnlyLock`. |
| ELOwf beschriftet den Weiterleiten-Knopf mit dem Label des **Nachfolgers**, ohne Label mit dessen Knotennamen. | Das Label am Nachfolger setzen, nicht am Knoten, an dem der Knopf erscheint. |
| Ohne Flag `FLAG_ONE_SUCCESSOR` (1) zeigt ELOwf bei mehreren Nachfolgern Checkboxen und einen allgemeinen Knopf statt je einem beschrifteten Knopf. | Flag 1 an Personenknoten mit mehreren Nachfolgern setzen. |
| Eine Formularseite, die als Referenz in einem Formularordner liegt (z. B. ein gemeinsamer Rahmen), gehört einem anderen Formular. | Referenzen nie über das eine Formular ändern. Beim Löschen eines Formularordners erst die Referenz lösen (`deleteSord(<Ordner>, <Referenz>)`), sonst trifft es das Original. |

## Ablage: Verweise, Verschieben, Löschen

| Falle | Was stattdessen |
|---|---|
| Ein Ordner listet Hauptablage und Verweise gemischt als Kinder. | Verweis = Kind, dessen `parentId` nicht der Ordner ist. Die Ablageorte stehen in `refPaths`, je Ort der Pfad bis zum Ordner; der mit `parentId` am Ende ist die Hauptablage. `findFirstSords` mit `SordC.mbAll` liefert `refPaths` mit. |
| `deleteSord(ordner, obj)` macht je nach Ordner etwas anderes: im Verweisordner entfernt es den Verweis, in der Hauptablage markiert es das Objekt als gelöscht. | Vorher prüfen, ob der Ordner Hauptablage oder Verweisordner ist (`elo_references`). |
| Löschen eines Ordners markiert jeden Eintrag darin mit demselben Zeitpunkt (`deleteDateIso`, UTC, minutengenau). `delDateIso` ist etwas anderes (Verfallsdatum aus den Metadaten). | Zum Wiederherstellen `deleteDateIso` nehmen. |
| Ein entfernter Verweis ist nur ein als gelöscht markierter Verweis. `restoreSord` mit `minDeleteDate` holt ihn mit dem Ordner zurück, wenn er ab dessen Löschzeitpunkt entfernt wurde; weil der Zeitpunkt minutengenau ist, auch kurz davor in derselben Minute. | Vor dem Wiederherstellen mit `FindOptions.inclDeleted` zählen, was mitkommt (`elo_restore` zeigt es), und überzählige Verweise danach wieder entfernen. Früher entfernte Verweise bleiben weg. |
| Ein Kind eines gelöschten Ordners lässt sich nicht für sich zurückholen, solange der Ordner gelöscht ist. | Erst den Elternordner, dann das Kind (oder beide in einem Aufruf, Eltern zuerst). |

## Aufgaben und Wiedervorlagen

| Falle | Was stattdessen |
|---|---|
| `findFirstTasks` sucht ohne Angabe nur Priorität 0 (`highestPriority` = `lowestPriority` = 0). Aufgaben und Wiedervorlagen mit Priorität 1 (mittel) oder 2 (niedrig) fehlen still. | Immer `setHighestPriority(0)` und `setLowestPriority(2)`. Umgekehrt lehnt der Indexserver ab (ELOIX:2000). |
| Wiedervorlagen zu als gelöscht markierten Objekten liefert die Aufgabensuche nicht, der Client zeigt sie auch nicht. Sie bleiben aber bestehen und kommen mit dem Objekt zurück. | `setInclDeleted(true)`; beim Aufräumen nach dem Löschen von Dokumenten an ihre Wiedervorlagen denken. |
| `setAllUsers(true)` ohne Objekt listet die Wiedervorlagen aller Konten. | Nur zusammen mit `setObjId`. |
| Datum und Frist einer Wiedervorlage stehen in UTC (`promptDateIso`, `dueDateIso`); Mitternacht deutscher Zeit ist 22:00 oder 23:00 Uhr am Vortag. | Zum Schreiben Ortszeit nach UTC umrechnen, zum Anzeigen zurück. |
| `checkinReminder(reminder, empfaengerIds, expandGroups, lock)` legt je Empfänger eine eigene Wiedervorlage an und gibt deren IDs zurück; mit `expandGroups` = `true` eine je Gruppenmitglied. `Reminder.name` höchstens 128 Zeichen. | IDs aus dem Rückgabewert zum Zurücklesen (`checkoutReminders`) nehmen. |
| `checkoutReminders` bricht bei einer unbekannten ID den ganzen Aufruf ab. `deleteReminders` löscht endgültig. | IDs einzeln lesen; vor dem Löschen alle Angaben sichern. |

## Indexserver-Skripte

| Falle | Was stattdessen |
|---|---|
| Ein nicht auflösbarer `//@include` stoppt beim Neuladen den **ganzen** Skript-Motor („Stopped due to fatal error / Cannot compile script"). Registrierte Funktionen und Workflow-Bausteine fallen aus. | Vor dem Neuladen alle Includes prüfen. Danach immer die Statusseite des Indexservers lesen. |
| Der Indexserver liest `//@include` **überall** als Include, auch mitten in einem Kommentar. | Die Zeichenfolge nur in den Kopfzeilen verwenden. |
| Direkt unter `IndexServer Scripting Base/_ALL/<eigener Ordner>` werden Includes aus Business-Solutions-Paketen nicht aufgelöst. | Eigene Skripte in ein Paket unter `Business Solutions Custom`, mit Referenz in `IndexServer Scripting Base/_ALL/business_solutions`. |
| IX-Skripte werden als cp1252 gelesen. | Nicht-ASCII nur als `\uXXXX`. |
| Ob eine neue Version wirklich geladen ist, zeigt die Statusseite nicht. | `getCompiledScripts()` liefert je Objekt-ID die MD5 der geladenen Fassung; sie ist gleich `DocVersion.getMd5()` der aktuellen Version. Vor und nach `reloadScripts()` vergleichen (`elo_ix_reload`). Fehlt eine ID nachher, wurde das Skript nicht kompiliert. |
| Ein Skript in einem Paket außerhalb von `IndexServer Scripting Base` wird nie geladen, auch nicht nach dem Neuladen. | Verweis nach `IndexServer Scripting Base/_ALL/business_solutions` anlegen (`elo_reference_set`), dann neu laden. |

## Rhino und Windows

| Falle | Was stattdessen |
|---|---|
| Ein eigener Rhino-`ErrorReporter` per `JavaAdapter` endet in einem StackOverflow. | `org.mozilla.javascript.tools.ToolErrorReporter` in einen Puffer schreiben lassen, das liefert Meldungen mit Zeile. |
| Mit „UTF-8 weltweit" (Codepage 65001) ist `[Console]::InputEncoding` UTF-8 *mit* BOM, und .NET schreibt das BOM schon beim Anlegen von `Process.StandardInput` in die Pipe. Rhino hält die erste Zeile dann für kaputtes JSON. | `[Console]::InputEncoding` auf UTF-8 ohne BOM setzen und einen eigenen `StreamWriter` auf `StandardInput.BaseStream` legen. |
| Bibliotheken im Klassenpfad schreiben auf stdout und zerstören damit das MCP-Protokoll. | `System.out` nach stderr umleiten und das Original nur für Protokollzeilen nutzen. Ausgabe nur ASCII (`\uXXXX`), dann funkt keine Codepage dazwischen. |
| Eine JVM je MCP-Sitzung kostet mit G1 rund 650 MB Commit (1/64 des RAM als Start-Heap). | `-XX:+UseSerialGC -Xms32m -XX:TieredStopAtLevel=1` und Java erst beim ersten Werkzeugaufruf starten. |
