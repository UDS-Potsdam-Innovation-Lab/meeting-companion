from kit import B, C, SHADOW, PEOPLE
from teams import T


def build(x=0, y=0):
    b = B("s12_")
    s = b.row(None, "12 Teams · recap in meeting chat", w=1440, h=900, fill="#F5F5F7", x=x, y=y, clip=True, key="screen",
              cross="min")
    rail = b.col(s, "Rail", w=68, sizingV="fill", fill="#EBEBEF", pad=[16, 0, 16, 0], gap=18, cross="center")
    for ic in ("🔔", "💬", "👥", "📅", "◆"):
        b.txt(rail, ic, size=20, color=C["ink2"] if ic != "◆" else C["accent"])
    lst = b.col(s, "Chats", w=300, sizingV="fill", fill="#FAFAFB", pad=12, gap=4, sides=[0, 1, 0, 0], stroke="#E1E1E6")
    b.txt(lst, "Chat", size=18, style="Bold")
    for nm, sub, on in (("Product sync · Beta launch", "Companion: Meeting recap", True),
                        ("Lena Sommer", "Sending the deck now", False), ("Pilot schools", "Yusuf: Mail is out", False)):
        r = b.col(lst, nm, gap=2, pad=[10, 12, 10, 12], radius=8, sizingH="fill", fill="#FFFFFF" if on else "none")
        b.txt(r, nm, size=13, style="SemiBold", fillW=True)
        b.txt(r, sub, size=12, color=C["muted"], fillW=True)

    main = b.col(s, "Conversation", sizingH="fill", sizingV="fill", gap=0)
    hd = b.row(main, "Head", gap=16, pad=[14, 24, 14, 24], fill="#FFFFFF", sizingH="fill", sides=[0, 0, 1, 0], stroke="#E1E1E6")
    b.txt(hd, "Product sync · Beta launch", size=16, style="Bold")
    for t_, on in (("Chat", True), ("Recap", False), ("Companion", False)):
        tt = b.col(hd, t_, pad=[4, 0, 4, 0], sides=[0, 0, 2, 0] if on else None, stroke=C["accent"] if on else None)
        b.txt(tt, t_, size=14, style="SemiBold" if on else "Regular", color=C["ink"] if on else C["muted"])
    feed = b.col(main, "Feed", gap=16, pad=[24, 32, 24, 32], sizingH="fill", sizingV="fill")
    b.txt(feed, "Meeting ended · 58 min", size=12, color=C["muted"], align="center", fillW=True)
    msg = b.row(feed, "Bot message", gap=12, cross="min")
    m = b.row(msg, "Mark", w=32, h=32, radius=16, fill=C["accent"], main="center")
    b.txt(m, "◆", size=14, style="Bold", color="#FFFFFF")
    mc = b.col(msg, "Body", gap=6)
    b.txt(mc, "Companion  ·  11:00", size=12, color=C["muted"])
    card = b.col(mc, "Recap card", gap=12, pad=20, w=620, fill="#FFFFFF", radius=10, stroke="#E1E1E6", effects=SHADOW)
    b.txt(card, "Meeting recap", size=18, style="Bold")
    b.txt(card, "Beta set for 14 Nov without offline mode. Pilot feedback positive; teachers need a short start guide. "
                "Q1 research budget approved.", size=13, color=C["ink2"], fillW=True, lh="150%")
    b.txt(card, "DECISIONS", size=11, style="SemiBold", color=C["muted"], ls=0.8)
    for d in ("Beta launches on 14 Nov without offline mode", "Pilot check-ins move to Thursdays", "€18k for Q1 user research"):
        r = b.row(card, d, gap=8, sizingH="fill")
        b.txt(r, "✓", size=12, style="Bold", color=C["green"])
        b.txt(r, d, size=13, fillW=True)
    b.txt(card, "TO-DOS", size=11, style="SemiBold", color=C["muted"], ls=0.8)
    for t_, who, due, dest in (("Inform the third pilot school", "YA", "Fri", "Jira BETA-212"),
                               ("Draft the start guide for teachers", "JR", "Wed", "Jira BETA-213"),
                               ("Book 6 teacher interviews", "LS", "15 Nov", "Planner")):
        r = b.row(card, t_, gap=8, sizingH="fill")
        b.avatar(r, who, 20)
        b.txt(r, t_, size=13, fillW=True)
        b.txt(r, due, size=12, color=C["muted"])
        b.chip(r, dest, C["accentInk"], C["accentSoft"], size=11, pad=(2, 8, 2, 8))
    rv = b.row(card, "Review", gap=8, pad=[8, 10, 8, 10], radius=8, fill=C["sunken"], sizingH="fill")
    b.txt(rv, "Reviewed by all 5 · 2 to-dos re-assigned, 1 due date moved", size=12, color=C["ink2"], fillW=True)
    br = b.row(card, "Buttons", gap=8)
    b.button(br, "Open full notes", "primary", size=13, pad=(8, 14, 8, 14))
    b.button(br, "Mind map", "ghost", size=13, pad=(8, 14, 8, 14))
    b.button(br, "My to-dos", "ghost", size=13, pad=(8, 14, 8, 14))
    rep = b.row(feed, "Reply", gap=10, cross="min")
    b.avatar(rep, "YA", 32)
    rc = b.col(rep, "Body", gap=4)
    b.txt(rc, "Yusuf Aydin  ·  11:14", size=12, color=C["muted"])
    bb = b.row(rc, "Bubble", pad=[10, 14, 10, 14], radius=10, fill="#E8EBFA")
    b.txt(bb, "Mail to the third school is out ✓ (closed BETA-212)", size=13)
    b.spacer(feed, "v")
    cmp = b.row(main, "Compose", pad=[12, 16, 12, 16], fill="#FFFFFF", radius=10, stroke="#E1E1E6", sizingH="fill")
    b.txt(cmp, "Type a message", size=13, color=C["muted"])
    return b
