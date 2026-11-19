import { type DropAction, type DropStatus, nextDropStatus } from './drop-state.js';

describe('nextDropStatus', () => {
  it.each([
    ['draft', 'submit', 'pending'],
    ['pending', 'approve', 'live'],
    ['pending', 'reject', 'rejected'],
    ['live', 'pause', 'paused'],
    ['paused', 'resume', 'live'],
    ['live', 'end', 'gone'],
    ['paused', 'end', 'gone'],
    ['live', 'expire', 'gone'],
    ['paused', 'expire', 'gone'],
    ['live', 'edit_text', 'pending'],
    ['paused', 'edit_text', 'pending'],
    ['draft', 'edit', 'draft'],
    ['rejected', 'edit', 'draft'],
    ['pending', 'remove', 'removed'],
    ['live', 'remove', 'removed'],
    ['paused', 'remove', 'removed'],
    ['gone', 'remove', 'removed'],
    ['rejected', 'remove', 'removed'],
  ])('%s + %s → %s', (from, action, to) =>
    expect(nextDropStatus(from as DropStatus, action as DropAction)).toBe(to));

  it.each([
    ['draft', 'approve'],
    ['gone', 'resume'],
    ['live', 'submit'],
    ['removed', 'edit'],
    ['pending', 'pause'],
    ['draft', 'remove'],
    ['removed', 'remove'],
    ['pending', 'edit'],
  ])('%s + %s throws drop.invalid_transition', (from, action) =>
    expect(() => nextDropStatus(from as DropStatus, action as DropAction)).toThrow(
      expect.objectContaining({ code: 'drop.invalid_transition', status: 409 }),
    ));
});
