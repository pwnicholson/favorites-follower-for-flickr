import { expect, test } from 'vitest';

function applySort(photos, sortBy) {
  const sorted = [...photos];
  if (sortBy === 'uploaded') {
    sorted.sort((a, b) => (b.dateupload || 0) - (a.dateupload || 0));
  } else if (sortBy === 'taken') {
    sorted.sort((a, b) => new Date(b.datetaken).getTime() - new Date(a.datetaken).getTime());
  } else {
    sorted.sort((a, b) => (b.date_faved || 0) - (a.date_faved || 0));
  }
  return sorted;
}

test('sorts photos by date_faved descending', () => {
  const input = [
    { id: '1', date_faved: 100 },
    { id: '2', date_faved: 300 },
    { id: '3', date_faved: 200 }
  ];
  const result = applySort(input, 'faved');
  expect(result[0].id).toBe('2');
  expect(result[1].id).toBe('3');
  expect(result[2].id).toBe('1');
});


test('deduplicates photos by id across users', () => {
  const photos = [
    { id: '123', title: 'Photo A', _from_nsid: 'user1' },
    { id: '123', title: 'Photo A', _from_nsid: 'user2' },
    { id: '456', title: 'Photo B', _from_nsid: 'user1' }
  ];
  const map = new Map();
  for (const p of photos) map.set(p.id, p);
  const result = Array.from(map.values());
  expect(result.length).toBe(2);
  expect(result.map(p => p.id)).toEqual(['123', '456']);
});