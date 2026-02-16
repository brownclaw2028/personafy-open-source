/**
 * Password/passphrase strength evaluator.
 * Extracted from CreateVault.tsx for reuse across components.
 */

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'password1234', 'password12345',
  '12345678', '123456789', '1234567890', '12345678901', '123456781234',
  'qwerty123', 'qwertyuiop', 'letmein', 'welcome', 'monkey123',
  'dragon123', 'master123', 'login123', 'abc12345', 'abcdefgh',
  'trustno1', 'iloveyou', 'sunshine', 'princess', 'football',
  'baseball', 'shadow123', 'michael1', 'jennifer', 'charlie1',
  'superman', 'computer', 'whatever', 'access14', 'mustang1',
  'passw0rd', 'p@ssword', 'p@ssw0rd', 'admin123', 'changeme',
]);

interface PasswordStrength {
  level: 1 | 2 | 3 | 4;
  label: string;
  color: string;
  textColor: string;
}

export function getPasswordStrength(password: string): PasswordStrength {
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { level: 1, label: 'Weak — this is a commonly used password', color: 'bg-red-400', textColor: 'text-red-400' };
  }

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { level: 1, label: 'Weak — try adding numbers and symbols', color: 'bg-red-400', textColor: 'text-red-400' };
  if (score <= 2) return { level: 2, label: 'Fair — getting there', color: 'bg-yellow-400', textColor: 'text-yellow-400' };
  if (score <= 3) return { level: 3, label: 'Good — nice password', color: 'bg-primary', textColor: 'text-primary' };
  return { level: 4, label: 'Strong — excellent!', color: 'bg-accent', textColor: 'text-accent' };
}

/**
 * Enforces minimum password requirements: at least 8 characters and
 * a strength score of 2 ("Fair") or higher.
 */
export function meetsMinimumRequirements(password: string): boolean {
  if (password.length < 8) return false;
  const { level } = getPasswordStrength(password);
  return level >= 2;
}
