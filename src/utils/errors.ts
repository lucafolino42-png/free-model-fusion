export class FusionError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly recoverable: boolean;

  constructor(
    message: string,
    code: string = 'INTERNAL_ERROR',
    statusCode: number = 500,
    recoverable: boolean = false
  ) {
    super(message);
    this.name = 'FusionError';
    this.code = code;
    this.statusCode = statusCode;
    this.recoverable = recoverable;
  }
}

export class ProviderError extends FusionError {
  public readonly providerId: string;

  constructor(message: string, providerId: string, statusCode: number = 502) {
    super(message, 'PROVIDER_ERROR', statusCode, false);
    this.name = 'ProviderError';
    this.providerId = providerId;
  }
}

export class CredentialError extends FusionError {
  public readonly providerId: string;

  constructor(providerId: string) {
    super(
      `No valid credential found for provider: ${providerId}`,
      'CREDENTIAL_ERROR',
      401,
      true
    );
    this.name = 'CredentialError';
    this.providerId = providerId;
  }
}

export class ConfigurationError extends FusionError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR', 500, false);
    this.name = 'ConfigurationError';
  }
}

export class WebSearchError extends FusionError {
  constructor(message: string, recoverable: boolean = true) {
    super(message, 'WEB_SEARCH_ERROR', 502, recoverable);
    this.name = 'WebSearchError';
  }
}

export class ValidationError extends FusionError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400, false);
    this.name = 'ValidationError';
  }
}
