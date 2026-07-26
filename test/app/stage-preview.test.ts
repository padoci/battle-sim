// @vitest-environment jsdom
import {createElement} from 'react';
import {cleanup, render} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {StagePreview} from '../../src/app/components/StagePreview';

afterEach(cleanup);

describe('StagePreview', () => {
  it('renders the stage frame using the arena\'s own classes', () => {
    // Borrowing the real classes is the point — it's why the still can't drift
    // from the stage's styling. If these get renamed, this should fail.
    const {container} = render(createElement(StagePreview));
    expect(container.querySelector('.battle-stage')).toBeTruthy();
    expect(container.querySelector('.stage-field')).toBeTruthy();
    expect(container.querySelector('.stage-world')).toBeTruthy();
    expect(container.querySelector('.message-box')).toBeTruthy();
    expect(container.querySelectorAll('.hp-block')).toHaveLength(2);
    expect(container.querySelectorAll('.sprite-holder')).toHaveLength(2);
  });

  it('puts each side where the handheld convention puts it', () => {
    const {container} = render(createElement(StagePreview));
    // Yours is the back sprite; theirs is the front one.
    const mine = container.querySelector('.sprite-holder.mine img') as HTMLImageElement;
    const theirs = container.querySelector('.sprite-holder.theirs img') as HTMLImageElement;
    expect(mine.getAttribute('src')).toMatch(/gen5-back/);
    expect(theirs.getAttribute('src')).not.toMatch(/gen5-back/);
  });

  it('is decoration, not a control', () => {
    // The mode cards below are the real affordance. If this ever gains a tab
    // stop it becomes a second, silent one that goes nowhere.
    const {container} = render(createElement(StagePreview));
    const root = container.querySelector('.stage-preview')!;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0);
  });

  it('gives the decorative sprites empty alt text', () => {
    const {container} = render(createElement(StagePreview));
    for (const img of container.querySelectorAll('img')) {
      expect(img.getAttribute('alt')).toBe('');
    }
  });
});
