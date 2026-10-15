import { Panel } from "./ui";

/** Plain explanation of what tailoring does (shown in the right column). */
export function HowItWorks({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Panel id="how" title="How tailoring works" icon="info" defaultOpen={defaultOpen} className="how">
      <ol>
        <li>
          The AI reads the job post and your <strong>master resume</strong>. Your master is never changed; every job
          gets its own version.
        </li>
        <li>
          It rewrites your <strong>summary and every bullet</strong> so the part each job or project shares with this
          job comes first, in plain words. Same number of bullets, about the same length, so the page keeps its size.
        </li>
        <li>
          <strong>Skills:</strong> the job's skills go first and less relevant ones are swapped for the job's keywords.
          Skills taken from the job post are listed under Tips, so you can remove any you haven't used.
        </li>
        <li>
          Every rewrite is checked: it must <strong>keep all your numbers</strong> and stay about the same length.
          If not, your original line stays.
        </li>
        <li>
          Click any text on the page to change it. <strong>PDF</strong> saves exactly what you see.
        </li>
      </ol>
    </Panel>
  );
}
