import type { List, ListItem, Paragraph, PhrasingContent, Root } from 'mdast';
import type { Parent } from 'unist';
import { visit } from 'unist-util-visit';
/**
 * CommonMark treats any "N. text" line as ordered-list item N.
 * For chat prose (e.g. Estonian "2025. aastal"), only treat ordered lists
 * that begin with "1." — otherwise unwrap back to a normal paragraph.
 */
export function remarkUnwrapOrderedListsNotStartingAtOne() {
  return (tree: Root) => {
    visit(tree, 'list', (node: List, index, parent: Parent | undefined) => {
      if (!node.ordered || index === undefined || !parent) return;
      const start = node.start ?? 1;
      if (start === 1) return;
      parent.children[index] = orderedListToParagraph(node, start);
    });
  };
}
function orderedListToParagraph(node: List, start: number): Paragraph {
  const children: PhrasingContent[] = [];
  let marker = start;
  for (let i = 0; i < node.children.length; i++) {
    const item = node.children[i];
    if (i > 0) children.push({ type: 'text', value: '\n' });
    children.push({ type: 'text', value: `${marker}. ` });
    children.push(...phrasingFromListItem(item));
    marker += 1;
  }
  return { type: 'paragraph', children };
}
function phrasingFromListItem(item: ListItem): PhrasingContent[] {
  const children: PhrasingContent[] = [];
  for (const child of item.children) {
    if (child.type === 'paragraph') {
      children.push(...child.children);
    }
  }
  return children;
}
