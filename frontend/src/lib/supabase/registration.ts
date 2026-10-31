export interface RegistrationInput {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export function validateRegistration(input: RegistrationInput): { valid: boolean; message?: string } {
  if (!input.fullName.trim()) return { valid: false, message: "Enter your full name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    return { valid: false, message: "Enter a valid email address." };
  }
  const password = input.password;
  if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return { valid: false, message: "Your password does not meet the requirements." };
  }
  if (password !== input.confirmPassword) {
    return { valid: false, message: "Passwords do not match." };
  }
  return { valid: true };
}
