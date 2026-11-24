import { beforeEach, describe, expect, it } from 'vitest';
import { addChild, createMindmap } from '../model/mindmap';
import { addMap, emptyWorkspace } from '../model/workspace';
import { clearWorkspace, loadWorkspace, saveWorkspace } from './persistence';

beforeEach(async () => {
  await clearWorkspace();
});

describe('IndexedDB persistence', () => {
  it('returns null when nothing is saved', async () => {
    expect(await loadWorkspace()).toBeNull();
  });

  it('saves and loads a workspace', async () => {
    let map = createMindmap({ id: 'm', title: 'T', rootText: 'R', at: { x: 1, y: 2 }, now: 1 });
    map = addChild(map, map.rootId, 'c1', 'Anak');
    const ws = { ...addMap(emptyWorkspace(), map), viewport: { x: 5, y: 6, zoom: 1.5 } };
    await saveWorkspace(ws);
    expect(await loadWorkspace()).toEqual(ws);
  });

  it('overwrites previous data', async () => {
    await saveWorkspace(addMap(emptyWorkspace(), createMindmap({ id: 'a', title: 'A', rootText: 'A', at: { x: 0, y: 0 } })));
    await saveWorkspace(emptyWorkspace());
    expect((await loadWorkspace())?.maps).toEqual([]);
  });
});

describe('IndexedDB persistence of notes', () => {
  const noted = (note: string) => {
    let map = createMindmap({ id: 'm', title: 'T', rootText: 'R', at: { x: 0, y: 0 }, now: 1 });
    map = { ...map, nodes: { ...map.nodes, [map.rootId]: { ...map.nodes[map.rootId], note } } };
    return addMap(emptyWorkspace(), map);
  };

  it('round-trips a note', async () => {
    const ws = noted('<p>Halo <a href="https://a.com">x</a></p>');
    await saveWorkspace(ws);
    expect(await loadWorkspace()).toEqual(ws);
  });

  it('sanitizes the note on save', async () => {
    await saveWorkspace(noted('<p>ok</p><script>1</script>'));
    expect((await loadWorkspace())?.maps[0].nodes['m:root'].note).toBe('<p>ok</p>');
  });
});
