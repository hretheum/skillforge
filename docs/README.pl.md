# skillforge

> Kompozytywne umiejętności dla potoków agentowych — jeden silnik, wymienne konfiguracje klientów.

[![Licencja: Apache 2.0 + Commons Clause](https://img.shields.io/badge/license-Apache--2.0%20%2B%20Commons%20Clause-blue.svg)](../LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](../package.json)
[![Testy](https://img.shields.io/badge/tests-passing-brightgreen.svg)](#)

Inne języki: [English](../README.md) · [Русский](README.ru.md)

## Czym to jest

**skillforge** to jeden generyczny silnik, który z wymiennej konfiguracji per-klient produkuje gotowe
**umiejętności** (skills) — wielokrotnego użytku zdolności, które agent może wywołać (na przykład
„stwórz komponent zgodny z systemem projektowym tego klienta"). Zamiast ręcznie pisać ten sam prompt dla
każdego klienta, opisujesz klienta raz jako dane; silnik składa umiejętność. Silnik nie wie nic o żadnym
konkretnym kliencie — cała wiedza o kliencie żyje w osobnej konfiguracji i powiązanych zasobach, więc ten
sam silnik obsługuje wielu klientów bez zmian w kodzie.

To **niezależne dzieło napisane od zera wyłącznie z koncepcji** (clean-room). Membrana jest
jednokierunkowa: *koncepcja* przechodzi, *kod nigdy*. Żadna linia cudzego kodu, konfiguracji ani danych
poufnych nie jest przenoszona — tylko idee i „jak to ma działać".


## Kluczowe cechy

- **Generyczny silnik** — katalog `src/` nie zawiera żadnej wiedzy o kliencie; podmiana konfiguracji daje
  inny zestaw umiejętności bez zmiany silnika.
- **Sześć rodzajów umiejętności** — `artifact` · `instruction` · `validation` · `analysis` ·
  `transformation` · `sync`, każdy z własnym podzbiorem etapów i klasą nadzoru (governance).
- **Podwójny interfejs** — CLI (`skillforge …`) oraz serwer MCP (Model Context Protocol przez stdio) dla
  dowolnego agenta lub IDE zgodnego z MCP.
- **Globalny magazyn umiejętności** — zainstalowane umiejętności żyją w `~/.skillforge/skills/`,
  współdzielone między projektami.
- **Trzy profile emisji** — `open-core` (domyślny, ścisły no-op zwracający SKILL.md bez zmian), `claude`
  oraz `codex` (czysto addytywne towarzysze dla tych środowisk).
- **Minimalny ślad środowiska uruchomieniowego** — jedyną zewnętrzną zależnością runtime jest SDK MCP;
  reszta to biblioteka standardowa Node.

## Szybki start

**Wybierz jedną** z dwóch opcji instalacji poniżej, a następnie opcjonalnie dodaj serwer MCP i pakiet umiejętności.

### Opcja A — Globalne CLI (zalecane)

Instalujesz raz, używasz wszędzie:

```bash
git clone https://github.com/hretheum/skillforge.git
cd skillforge
npm install
npm install -g .
skillforge --help
```

### Opcja B — Uruchom bezpośrednio bez instalacji

Jeśli nie chcesz instalować globalnie, uruchamiaj z katalogu repozytorium:

```bash
git clone https://github.com/hretheum/skillforge.git
cd skillforge
npm install
node bin/skillforge.js --help
```

> Wszystkie przykłady w tym README używają `skillforge …`. Jeśli wybrałeś Opcję B, zastąp to
> wyrażeniem `node bin/skillforge.js …`.

---

### Dodaj serwer MCP (opcjonalne)

Serwer MCP pozwala Claude Desktop (i każdemu innemu klientowi MCP) wywoływać narzędzia skillforge
bezpośrednio z konwersacji.

**Claude Desktop** — dodaj wpis do `claude_desktop_config.json`
(na macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "skillforge": {
      "command": "skillforge",
      "args": ["mcp"],
      "env": {
        "SKILLFORGE_STATE_DIR": "/Users/ty/Documents/skillforge-state"
      }
    }
  }
}
```

`SKILLFORGE_STATE_DIR` to katalog, w którym serwer MCP ma prawo czytać i zapisywać pliki (stan sesji
umiejętności, checkpointy brand-discovery itp.). Ustaw go na dowolny katalog należący do ciebie.
Zrestartuj Claude Desktop po zapisaniu.

**Albo niech skillforge sam dopisze wpis:**

```bash
skillforge init
```

**Inne klienty MCP** — uruchom serwer na stdio i wskaż na niego klienta:

```bash
skillforge mcp
```

---

### Zainstaluj pakiet umiejętności (opcjonalne)

Zainstaluj 266 społecznościowych umiejętności z kolekcji [ECC](https://github.com/affaan-m/ECC)
do globalnego magazynu jedną komendą:

```bash
skillforge skills add ecc
```

Wylistuj zainstalowane umiejętności:

```bash
skillforge skills list
```

---

## CLI: emit

`emit` rzutuje plik `SKILL.md` umiejętności na docelowe środowisko przez wybrany profil emisji.

| Flaga | Opis |
|---|---|
| `--skill <ścieżka>` | Ścieżka do `SKILL.md` do wyemitowania (wymagana) |
| `--profile <nazwa>` | Profil emisji: `open-core` (domyślny), `claude`, `codex` |
| `--registry <ścieżka>` | JSON rejestru (domyślnie: `skillforge.registry.json` w bieżącym katalogu) |
| `--out <katalog>` | Katalog wyjściowy (domyślnie: bieżący katalog) |
| `-h, --help` | Pokaż pomoc komendy |

```bash
# Open-core (domyślny): zwraca SKILL.md bajt w bajt, bez towarzyszy
skillforge emit --skill skills/create-component/SKILL.md

# Profil Claude: emituje SKILL.md plus jego towarzysza dla Claude
skillforge emit --skill skills/create-component/SKILL.md --profile claude

# Profil Codex, jawny rejestr i katalog wyjściowy
skillforge emit --skill skills/create-component/SKILL.md --profile codex \
  --registry skillforge.registry.json --out ./dist
```

## CLI: skills

Zarządzaj globalnym magazynem umiejętności w `~/.skillforge/skills/`.

```bash
# Zainstaluj pakiet (alias, nazwa pakietu npm lub lokalny katalog)
skillforge skills add ecc                          # pakiet społecznościowy ECC (266 umiejętności)
skillforge skills add @skillforge-core/ecc-bundle  # to samo, pełna nazwa pakietu

# Wypisz zainstalowane umiejętności z wersjami i źródłem
skillforge skills list

# Zapisz flagę konfiguracji (np. auto-aktualizacja przy starcie MCP)
skillforge skills config auto-update true
```

## Rodzaje umiejętności

*Rodzaj* umiejętności ustala, które etapy silnika działają i jak nadzorowane są jej efekty uboczne.
Rodzaje `write` i `bidirectional` przechodzą przez bramę nadzoru narzędzi (tool-governance); rodzaje
tylko do odczytu zwracają typowany wynik bez zapisu pliku.

| Rodzaj | Opis | Nadzór | Przykładowa umiejętność |
|---|---|---|---|
| `artifact` | Tworzy konkretny artefakt (komponent, plik) przez adaptery wyjściowe | `write` | `create-component` |
| `instruction` | Emituje krok po kroku dyrektywy agenta z referencji klienta | `none` | `verdex-create-component` |
| `validation` | Zwraca typowany werdykt `{pass, violations}` — nigdy zapis pliku | `none` | `verdex-disclosure-check` |
| `analysis` | Ustrukturyzowane rozumowanie tylko do odczytu nad zasobami klienta | `none` | `verdex-analytics` |
| `transformation` | Przekształca lub konwertuje istniejącą treść w nowy artefakt | `write` | — |
| `sync` | Dwukierunkowa rekonsyliacja między źródłem a celem | `bidirectional` | `sync-example` |

## Układ projektu

```
src/
  engine/      runSkill() — jedyne publiczne API + GenericExecutor
  registry/    deskryptory rodzajów umiejętności (sześć rodzajów) + katalog
  governance/  brama nadzoru narzędzi, audit trail, secret scan, skill_result
  loader/      ładowanie konfiguracji klienta + aktywacja
  adapters/    kontrakty adapterów wejścia/wyjścia i krawędzie uruchomienia
  skills/      kroki compose + sterowany danymi compose-registry
  emit/        warstwa eksportu: profile open-core / claude / codex
  core/        renderowanie promptów, atrybuty telemetrii sesji i cache
  mcp/         serwer MCP po stdio
clients/       konfiguracje per-klient (tylko dane): jeden katalog per klient, np. glasshouse, verdex, …
test/          zestaw testów node --test
tools/         bramy: registry-lint, determinism, secret-scan, cleanroom, …
docs/          pełna specyfikacja
```

## Dokumentacja

Pełna specyfikacja żyje w katalogu `docs/` — obejmuje wizję, architekturę, model klienta, adaptery,
formę znormalizowaną, umiejętności, loader, nadzór, profile wdrożeniowe, bezpieczeństwo i koszty.
Zacznij od [`docs/getting-started.md`](getting-started.md) lub [`docs/vision-and-problem.md`](vision-and-problem.md).

## Udział w projekcie

Zgłoszenia błędów, nowe rodzaje umiejętności, implementacje adapterów i poprawki dokumentacji są
mile widziane.

**Zanim zaczniesz:**

- Przeczytaj [`docs/vision-and-problem.md`](vision-and-problem.md) — zrozum czym skillforge jest,
  a czym nie jest, zanim zaproponujesz zmiany.
- Przeczytaj [`docs/architecture-overview.md`](architecture-overview.md) — mapa wszystkich
  poddokumentów i warstwowa struktura silnika.
- Przeczytaj [`CLAUDE.md`](../CLAUDE.md) — reguły projektu obowiązujące przy każdej pracy (polityka
  clean-room, dyrektywa walidacji, wymóg zamknięcia dokumentacji).

**Dokumenty według obszaru:**

| Obszar | Dokument |
|---|---|
| Nowy rodzaj umiejętności | [`skill-type-system.md`](skill-type-system.md) · [`skill-manifest-and-registry.md`](skill-manifest-and-registry.md) |
| Konfiguracja klienta | [`client-model.md`](client-model.md) · [`normalized-form.md`](normalized-form.md) |
| Adaptery wejścia/wyjścia | [`adapters.md`](adapters.md) |
| Nadzór i bramki narzędzi | [`tool-governance.md`](tool-governance.md) |
| Model bezpieczeństwa | [`security.md`](security.md) |
| Loader i aktywacja | [`loader-and-activation.md`](loader-and-activation.md) |
| Profile emisji | [`deployment-profiles.md`](deployment-profiles.md) |
| Słownik | [`glossary.md`](glossary.md) |

**Dodanie umiejętności do ECC** (pakiet społecznościowy):

skillforge dostarcza pakiet [ECC](https://github.com/affaan-m/ECC). Jeśli chcesz dodać umiejętność
do kolekcji społecznościowej, otwórz PR tam — umiejętności przyjęte upstream są automatycznie
włączane do kolejnego wydania bundla.

## Licencja

**Apache 2.0 + Commons Clause.** Możesz swobodnie używać, modyfikować i rozpowszechniać skillforge do
użytku osobistego i społecznościowego. Klauzula Commons Clause zabrania *sprzedaży* oprogramowania — w
tym płatnego hostingu lub usług doradczych/wsparcia, których wartość wynika w istotnej części z
funkcjonalności skillforge. Taki użytek komercyjny wymaga osobnej licencji komercyjnej. Pełny tekst
znajdziesz w pliku [LICENSE](../LICENSE).
