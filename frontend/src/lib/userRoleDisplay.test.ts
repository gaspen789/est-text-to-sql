import { describe, it, expect } from 'vitest';
import { userRoleDisplayName } from './userRoleDisplay';

describe('userRoleDisplayName', () => {
  const makeT = (overrides: Record<string, string>) => (key: string) => overrides[key] ?? key;

  describe('known role codes (ADM, CHA, AUD)', () => {
    it('returns translated name for ADM when translation exists', () => {
      const t = makeT({ 'roles.ADM': 'Administrator' });
      expect(userRoleDisplayName('ADM', 'Admin', t)).toBe('Administrator');
    });

    it('returns translated name for CHA when translation exists', () => {
      const t = makeT({ 'roles.CHA': 'Chatter' });
      expect(userRoleDisplayName('CHA', 'Chatter Backend', t)).toBe('Chatter');
    });

    it('returns translated name for AUD when translation exists', () => {
      const t = makeT({ 'roles.AUD': 'Auditor' });
      expect(userRoleDisplayName('AUD', 'Audit', t)).toBe('Auditor');
    });

    it('falls back to backendName when translation key is not found (t returns key)', () => {
      const t = makeT({}); // identity — returns key unchanged
      expect(userRoleDisplayName('ADM', 'Administrator', t)).toBe('Administrator');
    });

    it('is case-insensitive — lowercase code is normalized', () => {
      const t = makeT({ 'roles.ADM': 'Admin' });
      expect(userRoleDisplayName('adm', 'Admin Backend', t)).toBe('Admin');
    });

    it('trims whitespace from code before lookup', () => {
      const t = makeT({ 'roles.ADM': 'Admin' });
      expect(userRoleDisplayName('  ADM  ', 'Admin Backend', t)).toBe('Admin');
    });
  });

  describe('unknown role codes', () => {
    it('returns backendName for an unrecognized code', () => {
      const t = makeT({ 'roles.XYZ': 'Should not be used' });
      expect(userRoleDisplayName('XYZ', 'Custom Role', t)).toBe('Custom Role');
    });

    it('returns backendName for empty-ish unknown code', () => {
      const t = makeT({});
      expect(userRoleDisplayName('MGMT', 'Management', t)).toBe('Management');
    });

    it('returns empty backendName for unknown code when backendName is empty', () => {
      const t = makeT({});
      expect(userRoleDisplayName('XYZ', '', t)).toBe('');
    });
  });
});
