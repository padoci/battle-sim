import {useState} from 'react';

// Author's own words, verbatim (see repo root "ai usage policy.rtf").
const AI_POLICY_PARAGRAPHS = [
  `generative ai was used to write code for this website, please read on to learn why.`,
  `as I'm sure you know, ai is excellent at stealing without permission or even notifying the creator of the original work or art. this is effectively how programming has worked forever. we write a bit of code, steal some from stack overflow, steal more from a library and steal from an old project.`,
  `the "art" of programming comes from how you tie all of the pieces of code together to produce something new. in the same way that every note on a piano has ever been played, every line of code has ever been written. composing a song is how you tie the pre-existing notes together; writing a program is how you use the pre-existing code to make something new. programming before was like writing a song where you had to research to find every note; programming now is like writing the song and ai knows every note.`,
  `unfortunately, it's so much better than I will ever be at programming. that is why this website uses some code written by ai, as does every app or website you use these days.`,
  `I hope you can use and enjoy this website despite the ai usage.`,
  `thank you for reading :)`,
];

/** Footer's third row: AI usage disclosure (expandable) + a not-yet-live donate link. */
export function FooterExtras() {
  const [policyOpen, setPolicyOpen] = useState(false);
  return (
    <>
      <p className="footer-links">
        <button
          className="footer-toggle mono"
          onClick={() => setPolicyOpen(o => !o)}
          aria-expanded={policyOpen}
        >
          {policyOpen ? '▾ hide' : '▸'} AI usage policy
        </button>
        <span aria-hidden="true"> · </span>
        <button className="footer-donate mono" disabled title="Coming soon">
          Support this project<span className="soon-badge">soon</span>
        </button>
      </p>
      {policyOpen && (
        <div className="footer-policy mono" role="region" aria-label="AI usage policy">
          {AI_POLICY_PARAGRAPHS.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </div>
      )}
    </>
  );
}
