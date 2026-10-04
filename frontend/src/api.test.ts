import { describe, expect, it } from 'vitest';
import { ApiError, errorText } from './api';

describe('errorText', () => {
  it('says the session ended for a generic 401', () => {
    expect(errorText(new ApiError(401, 'Unauthorized'))).toBe('Your session has ended. Sign in again.');
    expect(errorText(new ApiError(401, ''))).toBe('Your session has ended. Sign in again.');
  });
  it('shows the server message for other 401s (regression: a wrong group password read as "session ended")', () => {
    expect(errorText(new ApiError(401, 'Incorrect password'))).toBe('Incorrect password');
  });
  it('shows the server message for other errors, and a plain line for network failures', () => {
    expect(errorText(new ApiError(400, 'Name must be 1-80 characters'))).toBe('Name must be 1-80 characters');
    expect(errorText(new TypeError('Failed to fetch'))).toMatch(/could not reach the server/i);
    expect(errorText('???', 'Fallback')).toBe('Fallback');
  });
});
