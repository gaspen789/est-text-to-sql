/**
 * Tests for password validation logic found in
 * frontend/src/routes/reset-password.tsx (handleSubmit function).
 *
 * Rules (in order, matching the component's if-checks):
 *   1. password must be non-empty
 *   2. password.length must be >= 15
 *   3. confirmPassword must equal password
 */
import { describe, it, expect } from 'vitest';

// Replicated validation logic from reset-password.tsx
type ValidationResult =
  | { valid: true }
  | { valid: false; reason: 'empty' | 'tooShort' | 'mismatch' };

function validateResetPassword(password: string, confirmPassword: string): ValidationResult {
  if (!password) return { valid: false, reason: 'empty' };
  if (password.length < 15) return { valid: false, reason: 'tooShort' };
  if (password !== confirmPassword) return { valid: false, reason: 'mismatch' };
  return { valid: true };
}

describe('reset-password validation', () => {
  describe('password presence check', () => {
    it('empty password is invalid', () => {
      const result = validateResetPassword('', 'anything');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('empty');
    });
  });

  describe('password length check', () => {
    it('password with 14 characters is too short', () => {
      const result = validateResetPassword('fourteenchars!', 'fourteenchars!');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('tooShort');
    });

    it('password with exactly 15 characters is valid length', () => {
      const result = validateResetPassword('exactly15chars!', 'exactly15chars!');
      expect(result.valid).toBe(true);
    });

    it('password with more than 15 characters is valid length', () => {
      const result = validateResetPassword('longpassword12345', 'longpassword12345');
      expect(result.valid).toBe(true);
    });

    it('password with 1 character is too short', () => {
      const result = validateResetPassword('a', 'a');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('tooShort');
    });
  });

  describe('password confirmation check', () => {
    it('mismatched confirmation password is invalid', () => {
      const result = validateResetPassword('password1234567', 'different1234567');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('mismatch');
    });

    it('matching confirmation password is valid', () => {
      const result = validateResetPassword('password1234567', 'password1234567');
      expect(result.valid).toBe(true);
    });

    it('empty confirmation with valid password is mismatch', () => {
      const result = validateResetPassword('password1234567', '');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('mismatch');
    });
  });

  describe('validation order — short password takes priority over mismatch', () => {
    it('reports tooShort before mismatch when password is both short and mismatched', () => {
      const result = validateResetPassword('short', 'different');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('tooShort');
    });
  });
});
