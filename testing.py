#!/usr/bin/env python3
"""
Fetch Bovada live events and display:
- matchup
- live score (if provided)
- main game total (O/U)

USAGE:
  python bovada_live_cbb.py

TIP:
  If CBB endpoint differs, open DevTools -> Network while browsing Bovada,
  filter for "services/sports/event", and paste the working endpoint below.
"""

from __future__ import annotations

import time
import sys
import requests
from typing import Any, Dict, List, Optional, Tuple

BASE = "https://www.bovada.lv"

# --- You may need to adjust this path ---
# Many Bovada sports use:
#   /services/sports/event/v2/events/A/description/<sport>/<league>
#
# Examples documented publicly:
#   NFL: /services/sports/event/v2/events/A/description/football/nfl  (StackOverflow / Reddit)
#   NBA event detail example: /services/sports/event/v2/events/A/description/basketball/nba/<event-slug>?lang=en
#
# Start by trying a likely CBB path; if it 404s/empty, use DevTools to find the correct one.
EVENTS_PATH = "/services/sports/event/v2/events/A/description/basketball/college-basketball?lang=en"

POLL_SECONDS = 15
TIMEOUT = 20

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; personal-script/1.0)",
    "Accept": "application/json,text/plain,*/*",
    "Referer": f"{BASE}/sports/basketball/college-basketball",
}


def safe_get(d: Dict[str, Any], *keys: str) -> Any:
    cur: Any = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur


def fetch_json(url: str) -> Any:
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def is_live(event: Dict[str, Any]) -> bool:
    # Bovada commonly uses states like "LIVE", "IN_PROGRESS", or flags.
    # We'll check a few common places.
    s = (event.get("status") or event.get("state") or "").upper()
    if "LIVE" in s or "IN_PROGRESS" in s:
        return True
    if event.get("live") is True:
        return True
    # Sometimes live info is nested
    live_obj = event.get("liveGame") or event.get("liveStatus") or event.get("liveData")
    if isinstance(live_obj, dict):
        return True
    return False


def extract_score(event: Dict[str, Any]) -> Optional[str]:
    """
    Bovada live score fields vary. We'll attempt several common patterns.
    Returns a human-readable score string or None.
    """
    # Pattern A: liveGame / score
    live = event.get("liveGame") or event.get("liveData") or event.get("liveStatus")
    if isinstance(live, dict):
        # Some variants:
        # live["score"]["home"], live["score"]["away"]
        score = live.get("score")
        if isinstance(score, dict):
            home = score.get("home") or score.get("homeScore")
            away = score.get("away") or score.get("awayScore")
            if home is not None and away is not None:
                return f"{away}-{home}"
        # Or: live["awayScore"], live["homeScore"]
        home = live.get("homeScore")
        away = live.get("awayScore")
        if home is not None and away is not None:
            return f"{away}-{home}"

    # Pattern B: competitors with score
    competitors = event.get("competitors")
    if isinstance(competitors, list) and len(competitors) >= 2:
        # Look for explicit score fields
        scores = []
        for c in competitors:
            if isinstance(c, dict):
                scores.append(c.get("score") or c.get("points"))
        if all(s is not None for s in scores):
            # Typically competitors[0]=away, [1]=home (not guaranteed)
            return f"{scores[0]}-{scores[1]}"

    return None


def extract_matchup(event: Dict[str, Any]) -> str:
    # Usually: competitors[0].name vs competitors[1].name
    comps = event.get("competitors")
    if isinstance(comps, list) and len(comps) >= 2:
        a = comps[0].get("name") if isinstance(comps[0], dict) else None
        b = comps[1].get("name") if isinstance(comps[1], dict) else None
        if a and b:
            return f"{a} vs {b}"

    # Fallback: event description
    desc = event.get("description") or event.get("shortDescription")
    if isinstance(desc, str) and desc.strip():
        return desc.strip()

    return "Unknown matchup"


def extract_main_total(event: Dict[str, Any]) -> Optional[str]:
    """
    Find the main game total (Over/Under).
    Bovada structure: event["displayGroups"] -> group["markets"] -> market["description"] == "Total"
    Outcomes often carry the points/price for Over and Under.
    """
    display_groups = event.get("displayGroups")
    if not isinstance(display_groups, list):
        return None

    # Prefer the "Game Lines" group if present
    groups = sorted(
        display_groups,
        key=lambda g: 0 if isinstance(g, dict) and (g.get("description") == "Game Lines") else 1,
    )

    for g in groups:
        if not isinstance(g, dict):
            continue
        markets = g.get("markets")
        if not isinstance(markets, list):
            continue

        # Look for a market called "Total"
        for m in markets:
            if not isinstance(m, dict):
                continue
            mdesc = (m.get("description") or "").strip().lower()
            if mdesc != "total":
                continue

            outcomes = m.get("outcomes")
            if not isinstance(outcomes, list) or len(outcomes) < 2:
                continue

            # Outcomes typically include:
            #   description: "Over" / "Under"
            #   price: {"american": -110, ...}
            #   handicap / points: 172.5
            over = under = None
            line = None

            for o in outcomes:
                if not isinstance(o, dict):
                    continue
                odesc = (o.get("description") or "").strip().lower()
                pts = o.get("handicap") or o.get("points") or safe_get(o, "price", "handicap")
                if pts is not None:
                    line = pts
                price_am = safe_get(o, "price", "american")
                if "over" in odesc:
                    over = price_am
                elif "under" in odesc:
                    under = price_am

            if line is None:
                # Sometimes line is at market level
                line = m.get("handicap") or m.get("points")

            if line is not None:
                # Format nicely
                if over is not None and under is not None:
                    return f"O/U {line} (O {over}, U {under})"
                return f"O/U {line}"

    return None


def flatten_events(payload: Any) -> List[Dict[str, Any]]:
    """
    Bovada endpoints often return a list of "competitions",
    each containing "events".
    """
    events: List[Dict[str, Any]] = []
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict):
                evs = item.get("events")
                if isinstance(evs, list):
                    for e in evs:
                        if isinstance(e, dict):
                            events.append(e)
    elif isinstance(payload, dict):
        evs = payload.get("events")
        if isinstance(evs, list):
            events = [e for e in evs if isinstance(e, dict)]
    return events


def clear_screen() -> None:
    sys.stdout.write("\033[2J\033[H")
    sys.stdout.flush()


def main() -> None:
    url = f"{BASE}{EVENTS_PATH}"
    while True:
        try:
            payload = fetch_json(url)
            events = flatten_events(payload)

            live_events = [e for e in events if is_live(e)]
            clear_screen()
            print(f"Bovada live events from: {url}")
            print(f"Updated: {time.strftime('%Y-%m-%d %H:%M:%S')}")
            print("-" * 80)

            if not live_events:
                print("No live events found (or endpoint doesn’t include live data).")
                print("If you expected live games, find the correct endpoint via DevTools -> Network.")
            else:
                for e in live_events:
                    matchup = extract_matchup(e)
                    score = extract_score(e) or "N/A"
                    total = extract_main_total(e) or "N/A"
                    print(f"{matchup}")
                    print(f"  Score: {score}")
                    print(f"  Total: {total}")
                    print()

        except requests.HTTPError as ex:
            clear_screen()
            print(f"HTTP error calling endpoint:\n  {url}\n  {ex}")
            print("\nFix: open Bovada in a browser, DevTools -> Network, search for 'services/sports/event'")
            print("and replace EVENTS_PATH with a working URL path.")
        except Exception as ex:
            clear_screen()
            print(f"Error: {ex}")

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
