import importlib, json, sys
from fc import FC

f = FC()
import os
ids = json.load(open("ids.json")) if os.path.exists("ids.json") else {}
for spec in sys.argv[1:]:
    mod, x, y = spec.split(":")
    b = importlib.import_module(mod).build(int(x), int(y))
    res = f.batch(b.cmds, label=mod)
    refs = {c["as"]: r.get("id") for c, r in zip(b.cmds, res) if "as" in c and isinstance(r, dict)}
    ids[mod] = {k: refs[v] for k, v in b.named.items()}
    print(mod, len(b.cmds), "cmds", ids[mod])
    f.call("ui.render", ids=[ids[mod]["screen"]], scale=1, path=f"/home/uds2027/code/meeting-companion/design/screens/{mod}.png")
json.dump(ids, open("ids.json", "w"), indent=1)
