import { describe, expect, it } from 'vitest';
import { ancestorDirs, pointIdFor } from '@twograph/vector';

describe('pointIdFor', () => {
  it('is deterministic and uuid-shaped', () => {
    const a = pointIdFor('r:a.ts#fn');
    expect(pointIdFor('r:a.ts#fn')).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(pointIdFor('r:a.ts#other')).not.toBe(a);
  });
});

describe('ancestorDirs', () => {
  it('lists every ancestor for subtree filtering', () => {
    expect(ancestorDirs('api/users/handlers.ts')).toEqual(['api', 'api/users']);
    expect(ancestorDirs('top.ts')).toEqual([]);
  });
});
