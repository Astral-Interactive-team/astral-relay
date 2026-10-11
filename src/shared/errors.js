// Shared error types for CLI, builder, and Agent.
// Each error carries a stable code so callers can branch without
// parsing message text. Thrown across module boundaries and caught
// at CLI/Agent top level for user-facing reporting.

export class RelayError extends Error {
  // Base error. Stores machine-readable code alongside message.
  constructor(message, code) {
    super(message);
    this.name = 'RelayError';
    this.code = code;
  }
}

export class ConfigError extends RelayError {
  // Bad or missing configuration value. Message names field and fix.
  constructor(message) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class AuthError extends RelayError {
  // Rejected Discord interaction (wrong guild or user). Never logs token.
  constructor(message) {
    super(message, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

export class BuildError extends RelayError {
  // EXE build failure. Message holds actionable cause, no secrets.
  constructor(message) {
    super(message, 'BUILD_ERROR');
    this.name = 'BuildError';
  }
}
