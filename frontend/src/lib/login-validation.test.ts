/**
 * Tests for login form validation logic found in
 * frontend/src/components/login-form.tsx (handleLogin function).
 *
 * Rules (in order, matching the component's if-checks):
 *   1. email must be non-empty (after trim)
 *   2. email must contain '@'
 *   3. password must be non-empty (after trim)
 */
import { describe, it, expect } from 'vitest';

// Replicated validation logic from login-form.tsx
type LoginValidationResult =
  | { valid: true }
  | { valid: false; reason: 'emailEmpty' | 'emailInvalid' | 'passwordEmpty' };

function validateLogin(email: string, password: string): LoginValidationResult {
  if (!email || email.trim() === '') return { valid: false, reason: 'emailEmpty' };
  if (!email.includes('@')) return { valid: false, reason: 'emailInvalid' };
  if (!password || password.trim() === '') return { valid: false, reason: 'passwordEmpty' };
  return { valid: true };
}

describe('login form validation', () => {
  describe('email validation', () => {
    it('empty email is invalid', () => {
      const result = validateLogin('', 'password');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('emailEmpty');
    });

    it('whitespace-only email is invalid', () => {
      const result = validateLogin('   ', 'password');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('emailEmpty');
    });

    it('email without @ is invalid', () => {
      const result = validateLogin('userexample.com', 'password');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('emailInvalid');
    });

    it('valid email with @ is accepted', () => {
      const result = validateLogin('user@example.com', 'password');
      expect(result.valid).toBe(true);
    });

    it('minimal email with just @ is accepted by the simple check', () => {
      // The component only checks for presence of '@', not full RFC validation
      const result = validateLogin('a@b', 'password');
      expect(result.valid).toBe(true);
    });
  });

  describe('password validation', () => {
    it('empty password is invalid', () => {
      const result = validateLogin('user@example.com', '');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('passwordEmpty');
    });

    it('whitespace-only password is invalid', () => {
      const result = validateLogin('user@example.com', '   ');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('passwordEmpty');
    });

    it('non-empty password is valid', () => {
      const result = validateLogin('user@example.com', 'anypassword');
      expect(result.valid).toBe(true);
    });

    it('single character password is valid (no minimum length for login)', () => {
      const result = validateLogin('user@example.com', 'x');
      expect(result.valid).toBe(true);
    });
  });

  describe('validation order', () => {
    it('email errors take priority over password errors', () => {
      const result = validateLogin('', '');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('emailEmpty');
    });

    it('invalid email format takes priority over empty password', () => {
      const result = validateLogin('notanemail', '');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('emailInvalid');
    });
  });
});
