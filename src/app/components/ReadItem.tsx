import {useState} from 'react';

/**
 * One expandable read: a sentence with its calc evidence behind a toggle
 * ("checks the working"). Shared by the 6-0 post-mortem and the dashboard
 * suggestions — anything shaped {sentence, evidence[]}.
 */
export function ReadItem({sentence, evidence}: {sentence: string; evidence: string[]}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pm-read">
      <p>{sentence}</p>
      {evidence.length > 0 && (
        <button className="pm-toggle mono" onClick={() => setOpen(o => !o)}>
          {open ? '▾ hide the calc' : '▸ show the calc'}
        </button>
      )}
      {open && (
        <ul className="pm-evidence mono">
          {evidence.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
