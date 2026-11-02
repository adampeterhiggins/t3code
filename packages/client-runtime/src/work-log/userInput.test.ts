import { expect, it } from "vite-plus/test";

import { getQuestionAnswerRows } from "./userInput.ts";

it("pairs multiple questions with their own answers by ID", () => {
  expect(
    getQuestionAnswerRows({
      requestId: "request",
      questionTextById: { computer: "Which computer?", accounts: "Which accounts?" },
      answers: { accounts: ["Claude", "Codex"], computer: ["This Mac"] },
      attachmentsByQuestionId: {},
    }),
  ).toEqual([
    { id: "computer", question: "Which computer?", answer: "This Mac" },
    { id: "accounts", question: "Which accounts?", answer: "Claude, Codex" },
  ]);
});
