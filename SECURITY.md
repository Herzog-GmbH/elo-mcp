# Sicherheitslücken melden

Bitte meldet Sicherheitslücken **nicht** als öffentliches Issue, sondern über **GitHub → Security → „Report a vulnerability"** (private Meldung). Wir melden uns so schnell wie möglich.

Hängt bitte keine echten Zugangsdaten, Hostnamen, Benutzernamen oder Dokumentinhalte an.

## Was wir als Lücke sehen

- Ein schreibendes oder bauendes Werkzeug läuft ohne passenden Schalter (`-Schreiben`, `-Bauen`) oder ohne gültiges Token aus der Vorschau.
- Ein Token wirkt für andere Argumente oder für ein inzwischen verändertes Objekt.
- Zugangsdaten landen im Klartext auf der Platte, im Protokoll, im Log oder in einer Antwort an die KI.
- Ein Werkzeug liefert Daten, die das angemeldete ELO-Konto selbst nicht sehen dürfte.
