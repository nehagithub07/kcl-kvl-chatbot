Virtual Lab Assistant provides local Q&A and walkthrough guidance for Kirchhoff’s Current Law (KCL) and Kirchhoff’s Voltage Law (KVL).

## Chatbot behavior

- Ask about KCL and KVL in one conversation. Naming a law or its measuring instrument updates the context automatically.
- Ask for either complete experimental procedure, or type **Start KCL walkthrough** or **Start KVL walkthrough**, followed by **Next step**, **Previous step**, or **Repeat step**. Each procedure has 12 steps.
- Ask follow-up questions such as “What is its range?” after discussing an instrument.
- Answers come from the local knowledge base, with normalization, keyword scoring, and fuzzy matching for alternate wording and common typos. The UI displays answers without suggestion menus or source labels. Uncertain questions request the missing details instead of guessing.
- The supplied 60 pre-test/post-test answers are available without multiple-choice options. Ask the exact question or use **pretest question 1** / **posttest question 12**. Diagram-dependent questions require a test and question number so an answer is not applied to the wrong circuit. An inconsistent answer key is flagged rather than presented as confirmed.
- A 2.2-second thinking indicator appears before the answer. Conversations, drafts, context, theme, and pending replies are saved in browser local storage, including when you refresh during thinking. **New chat** preserves previous conversations in the history sidebar. Light and dark modes share the same history.
- History remains on the same browser and site origin; clearing browser data removes it. Storage failures are shown in the interface. There is no account or cross-device synchronization.
- Use the trash icon beside a conversation to delete it from saved history. Deleting the last conversation starts a fresh chat. The **hamburger menu** button (three horizontal bars) beside the assistant title hides or shows the history sidebar, and remembers that preference after refresh. **New chat** remains available in the header when the sidebar is hidden.
- The assistant does not require an API key or connection to an external language model, and cannot observe or control the simulator.

## Updating the knowledge base

Edit `src/data/qaData.json`. `src/data/qaData.ts` imports that file directly; there is no second Q&A list to keep synchronized. Each entry needs a unique numeric `id`, `category`, `question`, `variations`, `keywords`, and `answer`. Categories or questions containing KCL or KVL associate an entry with that experiment.

Entries in `KCL Procedure` and `KVL Procedure` use `guideStep` with an `order` (1–12) and an `instruction`; full procedures use `procedureOverview`. Quiz entries use `quiz.stage`, `quiz.number`, and `quiz.requiresDiagram`. Diagram questions and numeric quizzes are excluded from fuzzy matching. Changes reload during development; rebuild the app to include them in production.

Run `npm test` for response and conversation regression tests, `npm run lint` for lint checks, and `npm run build` for production compilation and type checks. In Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The page in `src/app/page.tsx` renders the shared chat interface in `src/components/Chatbot.tsx`. Response matching and conversation context live in `src/lib/chatbot.ts`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
