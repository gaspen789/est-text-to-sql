import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { describe, it, expect } from 'vitest';

import { remarkUnwrapOrderedListsNotStartingAtOne } from './remark-unwrap-ordered-lists-not-starting-at-one';

function parseChatMarkdown(markdown: string) {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  remarkUnwrapOrderedListsNotStartingAtOne()(tree);
  return tree;
}

describe('remarkUnwrapOrderedListsNotStartingAtOne', () => {
  it('unwraps ordered lists that do not start at 1 (e.g. years)', () => {
    const tree = parseChatMarkdown('2025. aasta jaanuaris sõlmiti **282 abielu**.');
    expect(tree.children[0]).toMatchObject({
      type: 'paragraph',
      children: [
        { type: 'text', value: '2025. ' },
        { type: 'text', value: 'aasta jaanuaris sõlmiti ' },
        { type: 'strong', children: [{ type: 'text', value: '282 abielu' }] },
        { type: 'text', value: '.' },
      ],
    });
  });

  it('keeps ordered lists that start at 1', () => {
    const tree = parseChatMarkdown('1. esimene\n2. teine');
    expect(tree.children[0]).toMatchObject({
      type: 'list',
      ordered: true,
      start: 1,
    });
  });
});
