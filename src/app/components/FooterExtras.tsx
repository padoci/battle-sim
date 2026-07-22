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

const GAZA_APPEAL_URL = 'https://www.unicef.org.uk/donate/children-in-gaza-crisis-appeal/';

/** Footer's third row: AI usage disclosure + donations note, both expandable. */
export function FooterExtras() {
  const [policyOpen, setPolicyOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
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
        <button
          className="footer-toggle mono"
          onClick={() => setDonateOpen(o => !o)}
          aria-expanded={donateOpen}
        >
          {donateOpen ? '▾ hide' : '▸'} Donations
        </button>
      </p>
      {policyOpen && (
        <div className="footer-panel mono" role="region" aria-label="AI usage policy">
          {AI_POLICY_PARAGRAPHS.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </div>
      )}
      {donateOpen && (
        <div className="footer-panel mono" role="region" aria-label="Donations">
          <p>
            i&rsquo;m not accepting any donations for this website. if you wish to support it,
            please donate to those who need it most at{' '}
            <a href={GAZA_APPEAL_URL} target="_blank" rel="noreferrer">
              UNICEF&rsquo;s Children in Gaza Crisis Appeal
            </a>{' '}
            and let me know that you&rsquo;ve done so, it&rsquo;d bring me a lot of joy to know
            that my silly little website is helping make the world a better place :)
          </p>
        </div>
      )}
    </>
  );
}
