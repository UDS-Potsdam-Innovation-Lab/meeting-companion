"""Minimal client for FigCraft's loopback control channel (figcraft --control PORT)."""
import json, socket

class FC:
    def __init__(self, port=7979, agent="Claude"):
        self.s = socket.create_connection(("127.0.0.1", port))
        self.f = self.s.makefile("rwb")
        self.n = 0
        self.agent = agent

    def call(self, method, **params):
        self.n += 1
        self.f.write((json.dumps({"id": self.n, "method": method, "params": params}) + "\n").encode())
        self.f.flush()
        r = json.loads(self.f.readline())
        if not r.get("ok"):
            raise RuntimeError(f"{method}: {r.get('error')}")
        return r.get("result")

    def run(self, command, **params):
        return self.call("engine.execute", command=command, params=params, agent=self.agent)

    def batch(self, commands, label=None):
        p = {"commands": commands}
        if label:
            p["label"] = label
        return self.run("command.batch", **p)
