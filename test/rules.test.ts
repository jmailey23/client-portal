import assert from "node:assert/strict";
import { test } from "node:test";
import { currentDeal, phaseFor, phaseForStage } from "../src/phase.ts";
import { parseTourLog } from "../src/tours.ts";
import type { CrmRecord } from "../src/types.ts";
import { avaTourLog } from "../demo/fixtures.ts";

const deal = (id: string, dealstage: string, createdate: string): CrmRecord => ({ id, properties: { dealstage, createdate } });

test("tour notes become day cards, stops and notes, nothing dropped", () => {
  const cards = parseTourLog(avaTourLog);
  assert.deepEqual(cards.days, [
    {
      date: "Saturday October 10th",
      tours: [
        { name: "Maple Row Lofts", time: "11am", note: "ask about the corner unit" },
        { name: "The Ellsworth", time: "12:30pm", note: null },
        { name: "Cedar & Pine", time: "2pm", note: null },
      ],
    },
  ]);
  assert.deepEqual(cards.notes, [
    "Trying to book Halden Park for Sunday at 4:30pm",
    "Bring a photo ID and your last two pay stubs",
  ]);
});

test("a time inside a sentence is a note, not a tour", () => {
  assert.deepEqual(parseTourLog("Checking if they can do Friday by 3pm").notes, ["Checking if they can do Friday by 3pm"]);
  assert.equal(parseTourLog("Checking if they can do Friday by 3pm").days.length, 0);
});

test("stops before any date header still get a card", () => {
  assert.deepEqual(parseTourLog("Halden Park: 10:15 AM").days, [
    { date: "Upcoming tours", tours: [{ name: "Halden Park", time: "10:15 AM", note: null }] },
  ]);
});

test("a long line naming a day is a note, not a header", () => {
  const line = "Wednesday works too if your lease end date moves up a week";
  assert.deepEqual(parseTourLog(line), { days: [], notes: [line] });
});

test("a bare time with no property is a note", () => {
  assert.deepEqual(parseTourLog("11am").notes, ["11am"]);
});

test("empty or missing notes are empty cards", () => {
  assert.deepEqual(parseTourLog(null), { days: [], notes: [] });
  assert.deepEqual(parseTourLog("\n  \n"), { days: [], notes: [] });
});

test("stage maps to phase, unknown stages show the search", () => {
  assert.equal(phaseForStage("touring"), "searching");
  assert.equal(phaseForStage("applied"), "signing");
  assert.equal(phaseForStage("MOVED_IN"), "lifestyle");
  assert.equal(phaseForStage("closed_lost"), "dead");
  assert.equal(phaseForStage("a_stage_added_yesterday"), "searching");
  assert.equal(phaseForStage(undefined), "searching");
});

test("a returning client's newest deal decides, not their furthest along one", () => {
  const deals = [deal("d1", "closed_won", "2025-03-01"), deal("d2", "list_sent_30", "2026-10-01")];
  assert.equal(currentDeal(deals)?.id, "d2");
  assert.equal(phaseFor(deals), "searching");
});

test("a lost deal never hides a live one; all lost is dead", () => {
  assert.equal(phaseFor([deal("d1", "moved_in", "2026-01-01"), deal("d2", "closed_lost", "2026-09-01")]), "lifestyle");
  assert.equal(phaseFor([deal("d1", "closed_lost", "2026-01-01")]), "dead");
  assert.equal(phaseFor([]), "searching");
});
