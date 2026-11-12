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
| Laufende Workflows haben ihre eigene Kopie der Vorlage. | Änderungen an der Vorlage wirken nur auf neue Vorgänge. |

## Indexserver-Skripte

| Falle | Was stattdessen |
|---|---|
| Ein nicht auflösbarer `//@include` stoppt beim Neuladen den **ganzen** Skript-Motor („Stopped due to fatal error / Cannot compile script"). Registrierte Funktionen und Workflow-Bausteine fallen aus. | Vor dem Neuladen alle Includes prüfen. Danach immer die Statusseite des Indexservers lesen. |
| Der Indexserver liest `//@include` **überall** als Include, auch mitten in einem Kommentar. | Die Zeichenfolge nur in den Kopfzeilen verwenden. |
| Direkt unter `IndexServer Scripting Base/_ALL/<eigener Ordner>` werden Includes aus Business-Solutions-Paketen nicht aufgelöst. | Eigene Skripte in ein Paket unter `Business Solutions Custom`, mit Referenz in `IndexServer Scripting Base/_ALL/business_solutions`. |
| IX-Skripte werden als cp1252 gelesen. | Nicht-ASCII nur als `\uXXXX`. |

## Rhino und Windows

| Falle | Was stattdessen |
|---|---|
| Ein eigener Rhino-`ErrorReporter` per `JavaAdapter` endet in einem StackOverflow. | `org.mozilla.javascript.tools.ToolErrorReporter` in einen Puffer schreiben lassen, das liefert Meldungen mit Zeile. |
| Mit „UTF-8 weltweit" (Codepage 65001) ist `[Console]::InputEncoding` UTF-8 *mit* BOM, und .NET schreibt das BOM schon beim Anlegen von `Process.StandardInput` in die Pipe. Rhino hält die erste Zeile dann für kaputtes JSON. | `[Console]::InputEncoding` auf UTF-8 ohne BOM setzen und einen eigenen `StreamWriter` auf `StandardInput.BaseStream` legen. |
| Bibliotheken im Klassenpfad schreiben auf stdout und zerstören damit das MCP-Protokoll. | `System.out` nach stderr umleiten und das Original nur für Protokollzeilen nutzen. Ausgabe nur ASCII (`\uXXXX`), dann funkt keine Codepage dazwischen. |
| Eine JVM je MCP-Sitzung kostet mit G1 rund 650 MB Commit (1/64 des RAM als Start-Heap). | `-XX:+UseSerialGC -Xms32m -XX:TieredStopAtLevel=1` und Java erst beim ersten Werkzeugaufruf starten. |
