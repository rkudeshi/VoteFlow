"""Plain-language trend notes for a locality's live election ("How it's going").

Built with the data bundles (build_voteflow.py), so the notes refresh every time new ballot
files load. They point out what is changing rather than restating totals shown elsewhere on
the page: the past week against the same week of the November 2025 election and against the
statewide trend, shifts between in person and mail, mail returns (allowing for holidays with no
mail delivery), upcoming satellite openings, turnout rank movement, and what is still ahead.

Every sentence names the locality and the election in full, since a reader may see only this
one paragraph. Series are running totals by index: 0 = 46 days before Election Day, 46 =
Election Day, 52 = six days after.
"""
import datetime as dt

DAY = dt.timedelta(days=1)
DOWL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
MIN_WEEK = 150   # fewer ballots than this in a week is too noisy for week-to-week comparisons


def holiday(d):
    if d.month == 10 and d.weekday() == 0 and 8 <= d.day <= 14:
        return "Indigenous Peoples' Day"
    if d.month == 11 and d.day == 11:
        return 'Veterans Day'
    return None


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def day_name(d):
    return f"{DOWL[d.weekday()]}, {MON[d.month - 1]} {d.day}"


def pct(x):
    return f'{abs(round(x * 100))}%'


def pace(r):
    """How one number compares with another, as a phrase that reads before 'the same week ...'."""
    if r >= 1.9 and r <= 2.1:
        return 'about twice'
    if r >= 1.45:
        return f'about {r:.1f} times'
    if r >= 1.03:
        return f'{pct(r - 1)} more than'
    if r <= 0.97:
        return f'{pct(1 - r)} fewer than'
    return 'about the same as'


def vs(r):
    if r >= 1.9 and r <= 2.1:
        return 'about twice the pace of'
    if r >= 1.45:
        return f'about {r:.1f} times the pace of'
    if r >= 1.03:
        return f'{pct(r - 1)} ahead of'
    if r <= 0.97:
        return f'{pct(1 - r)} behind'
    return 'about even with'


def _tot(s, i, key=None):
    if s is None or i < 0 or i >= len(s['e']) or s['e'][i] is None:
        return None
    return s[key][i] if key else s['e'][i] + s['m'][i]


def _added(s, a, b, key=None):
    x, y = _tot(s, a, key), _tot(s, b, key)
    return None if x is None or y is None else y - x


def trend_notes(name, edate, cur, ref, state_cur, state_ref, today, sat_dates, rank_now, rank_week_ago):
    """name: locality; edate: live Election Day (date); cur/ref: this election's and November
    2025's series for the locality; state_cur/state_ref: the same statewide; today: last data
    day; sat_dates: first-open dates (date) of this election's satellite sites."""
    li = max((i for i, v in enumerate(cur['e']) if v is not None), default=-1)
    if li < 14 or ref is None or _tot(ref, li) is None:
        return ''
    out = []
    w1, w0 = _added(cur, li - 7, li), _added(cur, li - 14, li - 7)
    rw1 = _added(ref, li - 7, li)
    sw1, srw1 = _added(state_cur, li - 7, li), _added(state_ref, li - 7, li)
    season = _tot(cur, li) / _tot(ref, li) if _tot(ref, li) else None
    week_days = [today - DAY * k for k in range(7)]
    hol = next(((h, d) for d in week_days if (h := holiday(d))), None)

    # 1. This past week against the same week of November 2025, and against the state.
    if w1 and rw1 and w1 >= MIN_WEEK and season:
        r = w1 / rw1
        if r > season * 1.08:
            out.append(f"Early voting in {name} picked up this past week, running {vs(r)} the same week before the November 2025 election, a better pace than the season so far.")
        elif r < season / 1.08:
            out.append(f"Early voting in {name} slowed this past week, running {vs(r)} the same week before the November 2025 election, below the pace for the season so far.")
        else:
            out.append(f"Early voting in {name} is holding steady, running {vs(r)} the same week before the November 2025 election.")
        if sw1 and srw1:
            sr = sw1 / srw1
            if r > sr * 1.12:
                out.append(f"That beats the statewide trend ({vs(sr)} last November).")
            elif r < sr / 1.12:
                out.append(f"That trails the statewide trend ({vs(sr)} last November).")

    extra = []
    # 2. In person vs. mail, this week against the season.
    e1 = _added(cur, li - 7, li, 'e')
    if w1 and w1 >= MIN_WEEK and e1 is not None:
        sh1, shc = e1 / w1, cur['e'][li] / _tot(cur, li)
        if sh1 - shc >= 0.06:
            extra.append((sh1 - shc, f"More voters here are choosing to vote in person: {pct(sh1)} of this past week's ballots, up from {pct(shc)} for the season."))
        elif shc - sh1 >= 0.06:
            extra.append((shc - sh1, f"Mail is a growing share of the vote here: {pct(1 - sh1)} of this past week's ballots, up from {pct(1 - shc)} for the season."))

    # 3. Mail returns week over week, allowing for a holiday with no mail delivery.
    m1, m0 = _added(cur, li - 7, li, 'm'), _added(cur, li - 14, li - 7, 'm')
    sm1, sm0 = _added(state_cur, li - 7, li, 'm'), _added(state_cur, li - 14, li - 7, 'm')
    if m0 and m0 >= 50 and m1 is not None:
        g = m1 / m0 - 1
        sg = sm1 / sm0 - 1 if sm0 else None
        if g < -0.1 and hol and sg is not None and g < sg - 0.12:
            extra.append((0.3, f"Mail returns here fell {pct(g)} from the week before, more than the {hol[0]} holiday explains ({pct(sg)} statewide), so watch whether outstanding mail ballots are coming back more slowly."))
        elif g < -0.1 and hol:
            extra.append((0.12, f"Mail returns dipped this past week, mostly because there was no mail delivery on {hol[0]}."))
        elif g < -0.15 and sg is not None and g < sg - 0.12:
            extra.append((0.25, f"Mail returns here fell {pct(g)} from the week before, more than statewide, so outstanding mail ballots may be coming back more slowly."))
        elif g > 0.15:
            extra.append((min(g, 0.5) * 0.6, f"Mail returns here are building, up {pct(g)} from the week before."))

    # 4. Satellite sites opening soon, and what that stretch looked like last November.
    upcoming = sorted(d for d in sat_dates if d > today)
    if upcoming and (upcoming[0] - today).days <= 10:
        nd = upcoming[0]
        n = sum(1 for d in sat_dates if d == nd)
        k = (nd - today).days
        i0 = 46 - (edate - nd).days
        before, after = _added(ref, i0 - 7, i0, 'e'), _added(ref, i0, min(i0 + 7, 46), 'e')
        s = f"{'One new satellite site opens' if n == 1 else f'{n} more satellite sites open'} here on {day_name(nd)}"
        if before and after and after / before >= 1.25:
            s += f"; at the same point last November, in-person voting here was {after / before:.1f} times higher the following week"
        s += '.'
        extra.append((0.4, s))

    # 5. Turnout rank among Virginia's localities, only when it climbed into the top 50: a
    # drop, or a move further down the list, reads as a knock on the county.
    if rank_now and rank_week_ago and rank_now <= 50 and rank_week_ago - rank_now >= 5:
        s = f"{name} climbed from {ordinal(rank_week_ago)} to {ordinal(rank_now)} in turnout among Virginia's 133 localities this week"
        s += ', moving into the top 50.' if rank_week_ago > 50 else '.'
        extra.append(((rank_week_ago - rank_now) / 40, s))

    # Keep the note short: the pace, the strongest of the rest, and what is ahead, in at most
    # four sentences and about 520 characters.
    n_sent = lambda t: t.count('. ') + 1
    for _, t in sorted(extra, key=lambda x: -x[0]):
        if sum(map(n_sent, out)) + n_sent(t) <= 3 and len(' '.join(out + [t])) <= 400:
            out.append(t)

    # 6. What is still ahead, from November 2025.
    last = max(i for i, v in enumerate(ref['e']) if v is not None)
    final = _tot(ref, min(last, 49))
    if final and _tot(ref, li):
        ahead = 1 - _tot(ref, li) / final
        days = [(_added(ref, i - 1, i), i) for i in range(li + 1, 46) if _added(ref, i - 1, i) is not None]
        s = f"Looking ahead: last November, {pct(ahead)} of early ballots here came in after this point"
        if days:
            big, bi = max(days)
            bd = edate - DAY * (46 - bi)
            when = 'final Saturday' if 46 - bi == 3 else f"{DOWL[bd.weekday()]} {46 - bi} days before Election Day"
            s += f", and the busiest day was the {when}"
            if w1 and w1 >= MIN_WEEK and big / (w1 / 5) >= 1.5:
                s += f", about {big / (w1 / 5):.0f} times this past week's average weekday"
        out.append(s + '.')
    return ' '.join(out)
