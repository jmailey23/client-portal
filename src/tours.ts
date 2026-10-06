/**
 * The broker's tour notes, as cards.
 *
 * The broker types the tour schedule into one free text field on the deal,
 * the way she would text it to a client:
 *
 *   Saturday October 10th
 *   Maple Row Lofts: 11am (ask about the corner unit)
 *   * Bring a photo ID
 *
 * Asking her to fill in a structured form per tour would be asking her to
 * change how she works for the software's sake. So the software reads her
 * notes instead, with plain rules:
 *
 *   short line with a day or month name and no time  ->  a day header
 *   line with a time                                 ->  a tour stop
 *   ...unless the words before the time end in "at", "by", "for" and the like,
 *      which is a sentence ("trying to book for Friday at 4:30pm"), not a stop
 *   line starting with *                             ->  a note
 *   anything else                                    ->  a note
 *
 * Nothing is dropped. A line the rules cannot place is shown as a note, in
 * her words, which is always correct even when it is not pretty.
 */
import type { TourCards, TourDay } from "./types.ts";

const TIME = /(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i;
const DAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const MONTH = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const SENTENCE_BEFORE_TIME = /\b(at|by|around|for|until|before|after)\s*$/i;
const TRAILING_PUNCT = /[:,\-\u2013\u2014]\s*$/;

export function parseTourLog(text: string | null | undefined): TourCards {
  const days: TourDay[] = [];
  const notes: string[] = [];
  let day: TourDay | null = null;

  for (const line of String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (/^\*+/.test(line)) {
      notes.push(line.replace(/^\*+\s*/, ""));
      continue;
    }

    const time = TIME.exec(line);
    if (!time) {
      if ((DAY.test(line) || MONTH.test(line)) && line.length < 40) {
        day = { date: line.replace(/:?\s*$/, ""), tours: [] };
        days.push(day);
      } else {
        notes.push(line);
      }
      continue;
    }

    const before = line.slice(0, time.index).replace(TRAILING_PUNCT, "").trim();
    if (!before || SENTENCE_BEFORE_TIME.test(before) || before.length > 80) {
      notes.push(line);
      continue;
    }

    if (!day) {
      day = { date: "Upcoming tours", tours: [] };
      days.push(day);
    }
    const after = line.slice(time.index + time[0].length).trim().replace(/^\(/, "").replace(/\)$/, "").trim();
    day.tours.push({ name: before, time: time[1], note: after || null });
  }

  return { days, notes };
}
