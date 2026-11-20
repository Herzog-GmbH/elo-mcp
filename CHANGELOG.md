# Änderungen

## 0.16.0 – 2026-11-20

- **Wege, die bisher nur Einmal-Skripte konnten** (Anlass: Ablage mit Erkennung in einem Testarchiv; IX-Skript einspielen und neu laden, Bestand zählen, lange Trefferlisten, Zusatztext, Map-Felder zurücksetzen, Maskenkopie für einen Formular-Baukasten). Zwei neue Werkzeuge (jetzt 62), vier erweitert:
  - `elo_ix_reload` (Stufe 3, neu): `reloadScripts` zweistufig. `getCompiledScripts` liefert je Skript-ID die MD5 der geladenen Fassung; sie ist gleich der MD5 der aktuellen Dokumentversion. Damit zeigt die Vorschau je Skript in `pruefen` (bis 20), ob es geladen ist, in der aktuellen oder einer älteren Fassung, und ob es unter `Administration/IndexServer Scripting Base` liegt oder dort einen Verweis hat. Das Ergebnis zeigt dasselbe nach dem Neuladen, die Zahl der geladenen Skripte vorher/nachher und Skripte, die vorher geladen waren und danach fehlen (Kompilier- oder Include-Fehler). Außerhalb eines Testarchivs eine deutliche Warnung. `elo_script_update` und `elo_script_create` verweisen danach auf `elo_ix_reload`; `elo_script_create` warnt bei einem IX-Skript ohne Ort unter `IndexServer Scripting Base`.
  - `elo_count` (Stufe 1, neu): Gesamtzahl über eine Zählabfrage (`FindOptions.evalCount`), auch für eine ganze Maske. Mit `gruppe` (ein oder zwei Felder) und `gefuellt` (bis drei Felder) liest es die Treffer in Seiten zu 200 mit 200 ms Pause, höchstens 5000; größere Mengen lehnt die Zählabfrage vorher ab. Gelöschte Objekte zählen nicht, leere Werte erscheinen als `(leer)`. Ausgegeben werden nur Zahlen und die Gruppenwerte.
  - `elo_find_by_fields`: `ab` blättert (Startindex, bis 5000, `naechsteSeite` nennt den nächsten Wert), `gesamt` zählt alle Treffer, `spalten` grenzt die Indexfelder ein, `mapFelder` liest bis zu 10 Map-Felder je Treffer (eine Abfrage je Treffer, Passwort-/Token-Schlüssel als `***`).
  - `elo_set_fields`: `zusatztext` ersetzt den Zusatztext (bis 30000 Zeichen), `zusatztextLeeren` leert ihn. Vorschau bisher → neu, der alte Text wird vorher als JSON gesichert, danach zurückgelesen.
  - `elo_map_set`: `leerenMuster` leert alle vorhandenen Felder mit einem Schlüssel-Anfang oder Muster mit `*` und `?` (mindestens 3 Zeichen ohne Platzhalter). Die Vorschau nennt jedes getroffene Feld mit bisherigem Wert; Passwort-/Token-Felder bleiben und werden genannt. Kommt seit der Vorschau ein passendes Feld dazu, wird abgelehnt.
  - `elo_mask`: zeigt das ELOwf-Formular der Maske (Profiloption `ELOwf.maskforms`) und schreibt mit `datei` das Ergebnis als lokale JSON-Datei (Maskenkopie für eigene Werkzeuge ohne Suchen im Archiv); eine vorhandene Datei wird nur überschrieben, wenn sie selbst von `elo_mask` stammt.
- In [docs/FALLEN.md](docs/FALLEN.md) beschrieben: Ladestand der IX-Skripte über `getCompiledScripts`, Blättern mit `findNextSords`, Zählabfrage.
- Offline-Test um IX-Neuladen, Zusatztext, Map-Muster, Blättern, Zählen und Maskendatei erweitert (311/500/506 Prüfungen). Live in einem Testarchiv: Ladestand vor dem Neuladen, Blättern über Seitengrenzen gegen die Gesamtliste, Zählen und Gruppieren (879 Objekte, 5 Seiten), Maskendatei gegen eine von Hand gepflegte Kopie, Vorschauen von Zusatztext und Map.

## 0.15.0 – 2026-11-20

- **Wiedervorlagen**, drei neue Werkzeuge in `src/elo-mcp-wiedervorlagen.js` (jetzt 60). Anlass: Beim Aufräumen von Testaufgaben zählte der Client eine Aufgabe mehr, als der Server lesen und beenden konnte; Wiedervorlagen kannte er bisher gar nicht.
  - `elo_reminders` (Stufe 1): Wiedervorlagen über `findFirstTasks` mit `inclReminders`, ohne Workflows, `updateInUseDate` aus. Ohne Angabe das angemeldete Konto mit seinen Gruppen, mit `benutzer` ein anderes Konto, mit `objekt` alle Empfänger zu einem Objekt (`allUsers` nur zusammen mit `objId`). Je Eintrag ID, Name, Beschreibung, Objekt, Empfänger, Absender, Datum, Frist, Priorität und `faellig`. Mit `geloeschteObjekte` (`inclDeleted`) auch Wiedervorlagen zu als gelöscht markierten Objekten, gekennzeichnet mit `objektGeloescht`.
  - `elo_reminder_create` (Stufe 2): `createReminder` + `checkinReminder` je Empfänger (bis 10, Personen oder Gruppen; `anJedesMitglied` = `expandGroups`). Datum als Mitternacht Ortszeit nach UTC umgerechnet. Die Vorschau warnt bei gleichem Text für denselben Empfänger am Objekt, bei Datum in der Vergangenheit und bei gelöschtem Objekt; danach zurückgelesen.
  - `elo_reminder_delete` (Stufe 2): `deleteReminders` per `ids` oder für alle Wiedervorlagen eines Objekts (auch eines gelöschten), optional nur eines Empfängers. Endgültig, deshalb vorher Sicherung aller Angaben als JSON; jede ID wird einzeln gelesen, unbekannte und schon gelöschte stehen unter `ausgelassen`. Danach zurückgelesen.
- `elo_my_tasks` liefert jetzt auch Wiedervorlagen (Feld `art`: `workflow` oder `wiedervorlage`, dazu die Zahl je Art); `wiedervorlagen=false` wie bisher nur Workflow-Aufgaben.
- **Fehler behoben:** `findFirstTasks` sucht ohne Angabe nur Priorität 0 (hoch). `elo_my_tasks` und die Auswahl per `benutzer` in `elo_workflow_terminate` übersahen damit Aufgaben mit Priorität 1 und 2. Alle Aufgabensuchen setzen jetzt den Bereich 0 bis 2.
- In [docs/FALLEN.md](docs/FALLEN.md) beschrieben: Prioritätsfilter, ausgeblendete Wiedervorlagen gelöschter Objekte, Zeiten in UTC, `expandGroups`.
- Offline-Test um Wiedervorlagen im Speicher erweitert (275/433/439 Prüfungen). Live in einem Testarchiv: lesen (eigenes Konto, Objekt, gelöschte Objekte), anlegen mit Datum, Frist und Priorität, löschen per Objekt und per ID, Sichtbarkeit in `elo_my_tasks`.

## 0.14.0 – 2026-11-19

- **Vorgänge beenden:** neues Werkzeug `elo_workflow_terminate` (Stufe 2, jetzt 57). Anlass: Vor einem Anwendertest mussten Testaufgaben aufgeräumt werden, was bisher nur ein Einmal-Skript konnte.
  - Beendet laufende Vorgänge mit `terminateWorkFlow(flowId, LockC.YES)`: Sie stehen danach unter den beendeten Workflows, Dokumente und Map bleiben unverändert. `deleteWorkFlow` gibt es bewusst nicht.
  - Auswahl per `ids` (Vorgangs-IDs) oder `benutzer` (ID oder Name): alle Vorgänge mit offenen Aufgaben dieses Kontos über `findFirstTasks` mit `userIds`, `gruppen` (Standard an) und `vertretungen` (Standard aus), höchstens 1000 Aufgaben durchsucht, `updateInUseDate` aus. Beides optional nur Vorgänge einer `vorlage` (ID oder Name).
  - Die Vorschau listet je Vorgang ID, Name, Objekt, aktive Knoten mit Bearbeiter und Vorlage, dazu die Anzahl; nicht lesbare oder schon beendete Vorgänge stehen unter `ausgelassen`. Gesperrte Vorgänge werden gewarnt.
  - Höchstens 200 Vorgänge je Aufruf. In einem Archiv, dessen Name bzw. Text nicht „Test“ enthält, höchstens 20 und eine deutliche Warnung „kein Testarchiv (Produktiv)“. Gibt es mehr, sagt die Vorschau das; danach erneut aufrufen.
  - Vor dem Beenden ein Abbild jedes Vorgangs (Knoten, Bearbeiter, Kanten) als JSON unter `%LOCALAPPDATA%\elo-mcp\sicherung`. Danach je Vorgang zurückgelesen (als beendeter Vorgang lesbar) und als beendet oder mit Fehler und Grund gemeldet.
  - Offline-Test um einen Indexserver im Speicher für das Beenden erweitert (260/396/402 Prüfungen). Live in einem Testarchiv: Probe-Vorgang gestartet und über `ids` beendet; Auswahl über `benutzer` als Vorschau geprüft.

## 0.13.0 – 2026-11-15

- **Verweise, Verschieben, Löschen und Wiederherstellen**, fünf neue Werkzeuge in `src/elo-mcp-ablage.js` (jetzt 56). Anlass: das Aufräumen nach dem Umzug von Belegen in Akten (Verweise in Übersichtsordnern, alte Lieferantenverweise, leere Altordner), das bisher nur ein Einmal-Skript konnte:
  - `elo_references` (Stufe 1): Hauptablage und alle Verweise eines Objekts mit Pfad und Ordner-ID, auch bei gelöschten Objekten (mit Löschzeitpunkt und Konto). Mit `ordner` die Einträge eines Ordners, die dort nur Verweise sind (parentId ungleich dem Ordner), samt Hauptablage.
  - `elo_reference_set` (Stufe 2): Verweise anlegen (`refSord("", ordner, obj, -1)`) oder entfernen (`deleteSord(ordner, obj)`), als Liste von Objekt und Ordner, höchstens 200. Die Hauptablage wird nie entfernt; doppelte Verweise und Ringe werden abgelehnt. Sicherung der entfernten Verweise, danach zurücklesen.
  - `elo_move` (Stufe 2): Objekte verschieben (`refSord(alt, neu, obj, -1)`), Standard die Hauptablage, mit `von` (bei einem Objekt) ein bestimmter Ablageort, auch ein Verweis. Lehnt Ringe, fremd gesperrte Objekte und Ziele ab, in denen das Objekt schon liegt. Zurücklesen.
  - `elo_delete` (Stufe 3): als gelöscht markieren (`DeleteOptions.deleteFinally=false`), nie endgültig. Ohne `mitInhalt` nur Ordner und Ordnerbäume ohne Dokumente und ohne Verweise. Die Vorschau zählt Unterordner, Dokumente und Verweise, warnt vor Verweisen von außerhalb und vor Objekten direkt unter der Wurzel oder unter Administration; Objekte im Baum eines anderen gelisteten Ordners gehen mit ihm. `ueberspringen` lässt Objekte aus, die die Bedingung nicht erfüllen. Sicherung (IDs, GUIDs, Pfade, Inhalt) unter `%LOCALAPPDATA%\elo-mcp\sicherung`, höchstens 200 Objekte und 2000 Einträge in den Bäumen, Pausen zwischen den Ordnern.
  - `elo_restore` (Stufe 3): `restoreSord` mit `minDeleteDate` = Löschzeitpunkt des Objekts, mit `einzeln` `singleObject`. Die Vorschau zählt über `FindOptions.inclDeleted`, was mitkommt (auch entfernte Verweise) und was gelöscht bleibt. Ein gelöschter Elternordner muss zuerst oder im selben Aufruf zurück; die Reihenfolge stellt das Werkzeug selbst her.
- Im Testarchiv (IX 25.00) belegt und in [docs/FALLEN.md](docs/FALLEN.md) beschrieben: Löschen markiert den ganzen Baum mit demselben Zeitpunkt (UTC, minutengenau), ein entfernter Verweis ist nur ein als gelöscht markierter Verweis und kommt mit dem Wiederherstellen eines Ordners zurück, wenn er ab dessen Löschzeitpunkt entfernt wurde.
- Offline-Test um eine Ablage im Speicher erweitert, die sich wie im Testarchiv verhält (258/370/376 Prüfungen). Live in einem Wegwerf-Ordner durchgespielt: Verweis anlegen, verschieben (Hauptablage und Verweis), entfernen, Ordnerbaum löschen, wiederherstellen mit und ohne `einzeln`, Ablehnungen (Ring, Hauptablage, Inhalt, Verweis im Ziel).

## 0.12.0 – 2026-11-15

- **Farben, Gruppenaufgaben, Map eines Vorgangs, registrierte Funktionen, Formulardesigner**, sechs neue Werkzeuge (jetzt 51). Anlass: Lücken beim Bau eines Rechnungsworkflows, die bisher Einzelskripte oder der Web Client füllen mussten:
  - `elo_colors` (Stufe 1): Farbliste des Archivs mit ID, Name, Anzeigename, Kurzname und RGB (aus dem Windows-`COLORREF` umgerechnet); mit `objekt` die Farbe von bis zu 10 Objekten. `elo_get_object` zeigt die Farbe jetzt mit.
  - `elo_color_set` (Stufe 2): Farbe eines Objekts setzen, per ID, Name (`ELO.COLOR.RED`), Kurzname (`red`) oder Anzeigename (`Rot`). Mehrdeutige Namen werden abgelehnt und mit ID genannt. Vorschau bisher → neu mit ID und Name, Hinweis bei laufendem Workflow (der die Farbe als Status wieder setzen kann), Sicherung der alten Farbe, nur die Farbe wird eingecheckt (`SordC.mbKind`), danach zurücklesen.
  - `elo_task_take` (Stufe 2): Gruppenaufgabe annehmen wie „Workflow annehmen“ im Client, mit `zurueckgeben` an die Gruppe aus der Vorlage (`designDepartment`) oder an eine eigene Gruppe in `an` zurückgeben. Leitet nicht weiter.
  - `elo_function_read` (Stufe 1): registrierte Funktion ohne Freigabe, nur aus einer festen Liste lesender Funktionen. Zunächst `RF_sol_common_service_SordProvider`: höchstens 50 IDs, eine Suche nur mit Maske und Suchfeld, höchstens 300 Treffer (ohne Angabe 100).
  - `elo_function_call` (Stufe 3): beliebige registrierte Funktion, zweistufig; die Vorschau zeigt Funktion und Parameter und warnt, dass der Server nicht prüft, was die Funktion tut.
  - `elo_form_reload` (Stufe 3): Formulardesigner „Aktualisieren“ über `edit.jsp?reload=1` mit dem Ticket der Sitzung. Das Ticket geht nur an den Server des Indexservers und wird aus Antworten und Fehlermeldungen getilgt; eine Umleitung (Anmeldeseite) gilt als Fehler.
- `elo_map_set`: mit `workflow` statt `objekt` die Map eines laufenden Vorgangs, mit derselben Vorschau, Sicherung und Rückleseprüfung.
- `elo_forward_task`: `annehmen` nimmt eine Gruppenaufgabe vorher an und gibt sie zurück, wenn das Weiterleiten scheitert. Ohne den Schalter weist die Vorschau auf eine nicht angenommene Gruppenaufgabe hin.
- Offline-Test um Farbsuche, Grenzen des SordProvider, Formular-Adresse und die ganzen Abläufe der neuen Schreibwerkzeuge gegen einen Indexserver im Speicher erweitert (247/323/329 Prüfungen). Live gegen ein Testarchiv durchgespielt: Farbe setzen und zurück, Map eines Vorgangs setzen und leeren, Gruppenaufgabe annehmen und zurückgeben, Formulardesigner aktualisieren; `elo_function_call` nur als Vorschau.

## 0.11.0 – 2026-11-14

- **Notizen, Map-Felder und Feed**, fünf neue Werkzeuge (jetzt 45). Anlass: Freigaben und Hinweise, die nur als Stempel und Textnotiz auf dem Beleg stehen, Formularwerte in Map-Feldern und Feed-Einträge aus Workflows, alles bisher nur über Einzelskripte lesbar:
  - `elo_notes` (Stufe 1): Haftnotizen, Textnotizen, Stempel und andere Anmerkungen eines Objekts mit Art (Typnummer aus `NoteC` in Klartext), Seite, Verfasser, Datum und Text. Text- und Stempelnotizen tragen in `desc` einen Formatvorspann fester Länge (Schrift, Farbe); der Text kommt ohne ihn, mit `roh` zusätzlich der gespeicherte Wert. Ein Objekt oder eine Liste bis 10, nacheinander gelesen. Gelöschte Notizen werden nur gezählt.
  - `elo_map` (Stufe 1): Map-Felder eines Objekts, mit `workflow` die Map eines laufenden oder beendeten Vorgangs. `filter` als Schlüssel-Anfang oder Muster mit `*` und `?`, höchstens 500 Felder, lange Werte gekürzt. Werte von Schlüsseln, die auf `_PW` enden oder nach Passwort/Token aussehen, kommen als `***`.
  - `elo_map_set` (Stufe 2): Map-Felder eines Objekts setzen. Vorschau bisher → neu und Token, Sicherung der alten Werte als JSON vorher und nachher, zurücklesen. Leeren nur über `leeren` (der Indexserver entfernt den Eintrag dann ganz), ein leerer Wert in `felder` wird abgelehnt. Abgelehnt werden auch Passwort- und Tokenschlüssel, Platzhalter im Schlüssel und ein Schlüssel, den es am Objekt in anderer Groß-/Kleinschreibung gibt. Ein neuer Schlüssel wird in der Vorschau als solcher genannt. Die Map eines Vorgangs ändert das Werkzeug nicht.
  - `elo_feed` (Stufe 1): Feed eines Objekts, neueste Einträge zuerst, höchstens 50. Kommentare mit Erwähnungen als `@Name`; automatische Einträge (z. B. aus Workflow-Skripten) mit Sprachdatei, Schlüssel und Daten statt Text, weil der angezeigte Wortlaut nur in der Sprachdatei auf dem Server steht. `arten` grenzt ein, `roh` zeigt Typ, GUID und gespeicherten Text.
  - `elo_feed_post` (Stufe 2): Kommentar in den Feed eines Objekts schreiben, unter dem angemeldeten Konto. Vorschau und Token; die Vorschau meldet denselben Text im Feed und Erwähnungen, die eine Benachrichtigung auslösen. Danach zurücklesen. Ändern und Löschen gibt es nicht.
- Notizen und Stempel setzt oder löscht der Server nicht.
- Offline-Test um Vorspann, Notizarten, Maskierung, Filter, Eingabeprüfung, Feed-Einträge und die ganzen Abläufe von `elo_map_set` und `elo_feed_post` gegen einen Indexserver im Speicher erweitert (219/259/265 Prüfungen).

## 0.10.0 – 2026-11-12

- **Laufende Vorgänge reparieren und Vorlagen gezielt ändern**, sechs neue Werkzeuge (jetzt 40). Anlass: Änderungen an Onboarding und Offboarding, die bisher nur über Einzelskripte gingen:
  - `elo_workflows_of_template` (Stufe 1): laufende Vorgänge einer Vorlage, nur aktive, Suche über die Vorlagen-ID (höchstens 100), auf Wunsch mit den aktiven Knoten.
  - `elo_workflow_node_set` (Stufe 3): Name, Label, Formular, Bedingung, Flags, Bearbeiter und Skripteigenschaften (ganz oder einzelne Schlüssel) an einer Vorlage oder an bis zu 20 laufenden Vorgängen in einem Aufruf.
  - `elo_workflow_activate` (Stufe 3): nie betretenen Personenknoten aktivieren, auf Wunsch den hängenden Sammler davor durchschalten.
  - `elo_workflow_edges` (Stufe 3): Kanten an Vorlage oder Vorgang ergänzen und entfernen; erledigte Kanten bleiben, kein Knoten bleibt ohne Nachfolger.
  - `elo_form_pages` (Stufe 3): mehrere Formularseiten in einem Zug, Formularordner nach Vorbild samt dessen Referenzen; Referenzen werden nie geändert.
  - `elo_rename_in_folder` (Stufe 2): ein Wort in Kurzbezeichnung und Feldern einer Akte samt Unterobjekten ersetzen, dazu in Vorgangsnamen; nur ganze Wörter, auch mit Umlauten.
- `elo_workflow_build`: Bauplan auch aus einer lokalen Datei (`bauplanDatei`); der Inhalt geht in den Fingerabdruck, eine zwischen Vorschau und Ausführung geänderte Datei wird abgelehnt.
- Alle Werkzeuge an Workflows: gesperrte Vorgänge abgelehnt, nach Fehlern nur mit `mbOnlyLock` entsperrt, Sicherung als JSON (Vorlagen zusätzlich `.ewf`), danach zurücklesen.
- Offline-Test um Wortersetzung, Skripteigenschaften, Kanten, Knotenziele und Bauplan-Datei erweitert (157/182/188 Prüfungen).

## 0.9.0 – 2026-11-12

- **Benutzerkonten**, zwei neue Werkzeuge (jetzt 30):
  - `elo_user` (Stufe 1): Konto mit Windows-Anmeldename (Eigenschaft `PROP_NAME_OS`, daran hängt die SSO-Anmeldung), Mail, letzter Anmeldung und Gruppen. Sucht nach ID, ELO-Name, Windows-Name (mit oder ohne Domäne) oder Mail und nennt andere Konten mit demselben Windows-Namen bzw. derselben Mail. `doppelte=true` listet alle doppelten Windows-Namen und Mails im Archiv (ein Abruf der Benutzerliste).
  - `elo_user_set_login` (Stufe 3): Windows-Name und/oder Mail an einem Konto setzen oder leeren. Anlass: Zwei Konten mit demselben Windows-Namen lassen die SSO-Anmeldung scheitern. Ein Windows-Name, der schon an einem anderen Konto steht, wird abgelehnt, Gruppen ebenso. Vorschau und Token, Sicherung als JSON vorher und nachher, zurücklesen. Rechte, Gruppen, Name und Passwort bleiben unberührt.
- **Rechte und Vertretungen**, vier neue Werkzeuge (jetzt 34), Anlass: Vertretung in der Buchhaltung, bei der ein Recht an einem Knopf fehlte:
  - `elo_acl` (Stufe 1): Rechte eines Eintrags; mit `benutzer` die wirksamen Rechte je Person mit Herkunft (direkt, über Gruppe, geerbt vom Elternordner, als Eigentümer; Schlüssel und Beteiligte werden gemeldet, nicht geraten); mit `unterordner` die Ordner eine Ebene darunter, bei mehreren Personen nur die Abweichungen.
  - `elo_acl_set` (Stufe 3): Rechte eines einzelnen Eintrags setzen, `wie` eine andere Person oder `entfernen`. Nicht rekursiv. Vorschau und Token, Sicherung vorher und nachher, zurücklesen, Warnung bei Verlust des eigenen P-Rechts.
  - `elo_substitutions` (Stufe 1): Vertretungen einer Person in beide Richtungen, mit `aktivJetzt`.
  - `elo_substitution_set` (Stufe 3): Vertretung mit Zeitraum anlegen oder beenden. Falle: `deactivateSubstitution` lehnt ELO bei zeitgesteuerten Vertretungen ab (ELOIX:5071), und Zeiträume gelten tageweise; Beenden kürzt deshalb auf gestern und lässt heute beginnende Zeiträume weg. Gelöscht wird nichts.
- Offline-Test um Benutzer-, Rechte- und Vertretungsprüfungen erweitert.

## 0.8.0 – 2026-11-11

- **Stichwortlisten** (Pull Request #1), zwei neue Werkzeuge (jetzt 28):
  - `elo_keywords` (Stufe 1): Liste einer Feldgruppe lesen, Einträge als Baum, auf Wunsch mit IDs.
  - `elo_keywords_set` (Stufe 3): Liste anlegen oder Einträge ergänzen bzw. ersetzen, Unterlisten, Anzeigename und Paket. Vorschau und Token, Sicherung als JSON vorher und nachher, zurücklesen und vergleichen. IDs nach ELO-Schema `<Liste>¶.AA` (siehe `docs/FALLEN.md`).
  - Die Listen-ID wird wie die Feldgruppe in Großbuchstaben gesetzt (`aw_sign_status` → `AW_SIGN_STATUS`); `elo_keywords` liest eine Liste mit anderer Schreibweise zur Not wie angegeben.
  - Als „neu“ gilt eine Liste nur, wenn der Indexserver sie nicht kennt (`ELOIX:5023`). Andere Fehler beim Holen (Verbindung, Rechte, Sitzung) brechen ab, statt eine vorhandene Liste als neu zu planen.
- `elo_mask_create`: neuer Schalter `ohneFelder` legt eine Maske ohne Felder an (nur Rechte, Art und Reiter des Vorbilds). Vorher kopierte eine leere `felder`-Liste alle Felder, eine Maske ohne Felder ging nicht. Felder danach mit `elo_mask_fields`.
- Offline-Test um Stichwort- und `ohneFelder`-Prüfungen erweitert (102/123/129 Prüfungen).

## 0.7.0 – 2026-11-10

- **Verschlagwortungsmasken** lesen und bauen, vier neue Werkzeuge (jetzt 26):
  - `elo_mask` (Stufe 1): Art, Reiter samt Namen, alle Felder in Maskenreihenfolge mit Typ, Reiter, Zeile, Spalten, Länge, Pflicht und Rechten, dazu eine Layout-Prüfung.
  - `elo_mask_create` (Stufe 3): neue Maske als Kopie einer vorhandenen, alle oder ausgewählte Felder, andere Anzeigenamen und Reiter, Dokument-, Ordner- oder reine Suchmaske.
  - `elo_mask_fields` (Stufe 3): Felder hinten anhängen (nächste freie Zeile oder direkt unter einem Feld) oder vorhandene ändern (Name, Typ, Länge, Spalte, nur Stichwortliste, Pflicht, Rechte).
  - `elo_mask_tabs` (Stufe 3): Reiter benennen, Felder auf einen anderen Reiter oder Platz verschieben, Zeilen lückenlos ordnen.
- Fest eingebaute Regeln aus echten Störungen: Reiter mit Namen, Reiter 0 ab Zeile 4, Rechte an jeder Zeile, Eingabefeld nach der Beschriftung, keine Klammern im Anzeigenamen, Reihenfolge der Zeilen bleibt, IDs 50 bis 59 frei. Details in `docs/FALLEN.md`.
- Wie beim übrigen Bauen: Vorschau und Einmal-Token, Sicherung der Maske als JSON vorher und nachher unter `%LOCALAPPDATA%\elo-mcp\sicherung`, nach dem Speichern zurücklesen und vergleichen. Löschen gibt es nicht.
- Offline-Test mit Maskenprüfungen (86/106/112 Prüfungen).

## 0.6.0 – 2026-10-18

- **Zwei Archive in einem Eintrag**, z. B. Produktiv und Test: `-IxUrl2` mit `-Name`/`-Name2` (Kurznamen), `-Schreiben2`, `-Bauen2`, `-CredentialFile2`, `-Archiv2`. Im Paket für Claude Desktop als „Archiv 2" in den Einstellungen.
- Jedes Werkzeug hat dann den Parameter `archiv`, ohne Angabe gilt das erste Archiv. Die Hinweise an die KI nennen beide Archive mit ihren Stufen, Schreib- und Bauwerkzeuge sagen, in welchem Archiv sie gehen.
- Je Archiv ein eigener Java-Prozess mit eigenen Zugangsdaten und Stufen: Verbindungen, Zwischenspeicher und Tokens mischen sich nicht. Ein Token aus der Vorschau gilt nur im Archiv der Vorschau. Java startet je Archiv erst beim ersten Aufruf.
- `elo_whoami`, Vorschau, Ergebnis und Protokoll nennen das Archiv.
- Der Schlüssel des Zwischenspeichers umfasst jetzt auch `elo-mcp.ps1`.
- Offline-Test mit drittem Lauf „zwei Archive" (50/68/74 Prüfungen).

## 0.5.0 – 2026-10-18

- MCPB-Paket (MCP Bundle) für Claude Desktop: `elo-mcp-<version>.mcpb` aus dem GitHub-Release per Doppelklick installieren, IX-URL und Stufen in den Einstellungen der Erweiterung. Zugangsdaten bleiben bei `Set-EloCredential.ps1`, die ELO-Bibliotheken kommen weiter aus dem installierten Client.
- `mcpb\manifest.json`, Startskript `mcpb\mcpb-start.ps1` (Einstellungen → Schalter von `elo-mcp.ps1`) und `tools\build-mcpb.ps1` (baut reproduzierbar, prüft Version und ASCII, trägt SHA-256 in `server.json` ein).
- `server.json` für die offizielle MCP Registry (`io.github.Herzog-GmbH/elo-mcp`, Paket `mcpb`).
- `test\test-mcpb.py`: startet das gebaute Paket so, wie Claude Desktop es startet, und ruft Werkzeuge auf.

## 0.4.0 – 2026-10-18

Erste öffentliche Fassung.

- 22 Werkzeuge in drei Stufen: 13 lesende (immer an), 6 schreibende (`-Schreiben`), 3 bauende (`-Bauen`).
- Nicht freigeschaltete Werkzeuge stehen nicht in `tools/list` und werden beim Aufruf abgelehnt.
- Schreiben und Bauen zweistufig mit Vorschau und Einmal-Token, lokales Protokoll.
- Bauplan-Prüfungen für Workflow-Vorlagen, Syntax- und Include-Prüfung für ELOas-Regeln und IX-Skripte.
- Vorschalt in Windows PowerShell: Java erst beim ersten Werkzeugaufruf, Ende nach Leerlauf.
- Einstellbar: IX-URL, Zugangsdatei, Client-Ordner, Archivname, Datumsregel für Textfelder.
- Getestet gegen Indexserver 25.00 mit dem ELO Client 25 und dem ELO Java Client. Gesucht wird zuerst `ELO Client`, dann `ELO Java Client`.
- Offline-Test (`test\offline.ps1`, auch Vorschau und Token: einmal benutzbar, Ablauf, Argumente, veränderte Objekte) und Live-Test (`test\test-mcp.py`).
