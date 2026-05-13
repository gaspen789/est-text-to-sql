import { describe, it, expect } from 'vitest';
import { splitAssistantMessage } from './assistant-message-split';

describe('splitAssistantMessage', () => {
  describe('thinking tags', () => {
    it('extracts content from <thinking> tags into thinking field', () => {
      const result = splitAssistantMessage('<thinking>I am reasoning</thinking>\nHello user');
      expect(result.thinking).toBe('I am reasoning');
      expect(result.body).toBe('Hello user');
    });

    it('returns null thinking when no thinking tags or markers', () => {
      const result = splitAssistantMessage('Hello user');
      expect(result.thinking).toBeNull();
      expect(result.body).toBe('Hello user');
    });

    it('trims whitespace inside thinking blocks', () => {
      const result = splitAssistantMessage('<thinking>  spaced content  </thinking>\nAnswer');
      expect(result.thinking).toBe('spaced content');
    });

    it('handles multiple thinking blocks by joining them', () => {
      const result = splitAssistantMessage(
        '<thinking>First thought</thinking>\n<thinking>Second thought</thinking>\nFinal answer'
      );
      expect(result.thinking).toBe('First thought\n\nSecond thought');
      expect(result.body).toBe('Final answer');
    });

    it('is case-insensitive for thinking tags', () => {
      const result = splitAssistantMessage('<THINKING>uppercase</THINKING>\nBody');
      expect(result.thinking).toBe('uppercase');
      expect(result.body).toBe('Body');
    });

    it('handles thinking tag with multiline content', () => {
      const result = splitAssistantMessage('<thinking>\nline one\nline two\n</thinking>\nAnswer');
      expect(result.thinking).toBe('line one\nline two');
      expect(result.body).toBe('Answer');
    });
  });

  describe('partial / streaming thinking blocks', () => {
    it('handles unclosed <thinking> tag when partialThinking=true', () => {
      const result = splitAssistantMessage('Before<thinking>partial content', {
        partialThinking: true,
      });
      expect(result.thinking).toBe('partial content');
      expect(result.body).toBe('Before');
    });

    it('does not handle unclosed <thinking> without partialThinking option', () => {
      const result = splitAssistantMessage('Some<thinking>unclosed');
      expect(result.thinking).toBeNull();
      expect(result.body).toBe('Some<thinking>unclosed');
    });

    it('partial thinking with empty prefix produces empty body', () => {
      const result = splitAssistantMessage('<thinking>streaming...', {
        partialThinking: true,
      });
      expect(result.thinking).toBe('streaming...');
      expect(result.body).toBe('');
    });
  });

  describe('**Vastus:** and **Answer:** markers', () => {
    it('treats text before **Vastus:** as thinking', () => {
      const result = splitAssistantMessage('reasoning prose\n**Vastus:** actual answer');
      expect(result.thinking).toBe('reasoning prose');
      expect(result.body).toBe('**Vastus:** actual answer');
    });

    it('treats text before **Answer:** as thinking', () => {
      const result = splitAssistantMessage('reasoning prose\n**Answer:** actual answer');
      expect(result.thinking).toBe('reasoning prose');
      expect(result.body).toBe('**Answer:** actual answer');
    });

    it('is case-insensitive for **Vastus:** marker', () => {
      const result = splitAssistantMessage('preamble\n**vastus:** body');
      expect(result.thinking).toBe('preamble');
      expect(result.body).toBe('**vastus:** body');
    });

    it('is case-insensitive for **Answer:** marker', () => {
      const result = splitAssistantMessage('preamble\n**answer:** body');
      expect(result.thinking).toBe('preamble');
      expect(result.body).toBe('**answer:** body');
    });

    it('uses the earlier marker when both **Vastus:** and **Answer:** appear', () => {
      const result = splitAssistantMessage(
        'reasoning\n**Vastus:** first answer\n**Answer:** second answer'
      );
      expect(result.thinking).toBe('reasoning');
      expect(result.body).toContain('**Vastus:**');
    });

    it('does not split when marker is at position 0 (no leading text)', () => {
      const result = splitAssistantMessage('**Vastus:** direct answer');
      expect(result.thinking).toBeNull();
      expect(result.body).toBe('**Vastus:** direct answer');
    });
  });

  describe('combining thinking tags and markers', () => {
    it('collects both thinking tag content and prose before marker', () => {
      const result = splitAssistantMessage(
        '<thinking>tag thoughts</thinking>\nextra prose\n**Vastus:** answer'
      );
      expect(result.thinking).toContain('tag thoughts');
      expect(result.thinking).toContain('extra prose');
      expect(result.body).toBe('**Vastus:** answer');
    });
  });

  describe('empty / null content', () => {
    it('handles empty string', () => {
      const result = splitAssistantMessage('');
      expect(result.thinking).toBeNull();
      expect(result.body).toBe('');
    });

    it('handles whitespace-only string', () => {
      const result = splitAssistantMessage('   ');
      expect(result.thinking).toBeNull();
      expect(result.body).toBe('');
    });

    it('normalizes CRLF to LF', () => {
      const result = splitAssistantMessage('line1\r\nline2');
      expect(result.body).toBe('line1\nline2');
    });

    it('collapses excessive blank lines', () => {
      const result = splitAssistantMessage('a\n\n\n\nb');
      expect(result.body).toBe('a\n\nb');
    });
  });
});
