import type { Meeting } from "./model";

// Sample data from frame 01, used by tests, the e2e build and screenshots.
export const FIXTURE_PARTICIPANTS = [
  { id: "p-mk", name: "Mara Klein" },
  { id: "p-tb", name: "Tobias Brandt" },
  { id: "p-ls", name: "Lena Sommer" },
  { id: "p-ya", name: "Yusuf Aydin" },
  { id: "p-jr", name: "Jana Roth" },
];

export function filledMeeting(): Meeting {
  return {
    version: 1,
    id: "fixture-filled",
    title: "Product sync · Beta launch",
    date: "2026-10-30",
    start: "10:00",
    end: "11:00",
    participants: FIXTURE_PARTICIPANTS.map((p) => ({ ...p })),
    items: [
      { id: "i-1", title: "Check-in & goals", outcome: "", lead: "p-mk", goal: "inform", minutes: 5 },
      {
        id: "i-2",
        title: "Beta launch: scope and date",
        outcome: "a launch date everyone commits to",
        lead: "p-tb",
        goal: "decide",
        minutes: 15,
      },
      {
        id: "i-3",
        title: "Pilot schools: feedback so far",
        outcome: "",
        lead: "p-ls",
        goal: "discuss",
        minutes: 15,
      },
      {
        id: "i-4",
        title: "Budget for Q1 user research",
        outcome: "",
        lead: "p-ya",
        goal: "decide",
        minutes: 10,
      },
      {
        id: "i-5",
        title: "Open questions & next steps",
        outcome: "",
        lead: "p-mk",
        goal: "discuss",
        minutes: 10,
      },
    ],
    updatedAt: 1,
  };
}

export function overBudgetMeeting(): Meeting {
  const m = filledMeeting();
  m.id = "fixture-over";
  m.items = m.items.map((it) => (it.id === "i-3" ? { ...it, minutes: 30 } : it));
  return m;
}
