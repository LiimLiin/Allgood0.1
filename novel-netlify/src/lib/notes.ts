export type Note = {
  id: string;
  name: string;
  body: string;
  updatedAt: number;
};

export type Volume = {
  id: string;
  name: string;
  notes: Note[];
};

const STORAGE_KEY = "zhiye-notes-v2";
const LEGACY_KEY = "zhiye-notes-v1";

const STARTER: Volume[] = [
  {
    id: "vol-1",
    name: "第一篇",
    notes: [
      {
        id: "note1",
        name: "note1",
        updatedAt: 0,
        body: `雨停的时候，巷口的灯还亮着。

林夏把稿纸按页码摊在桌上。她只写到推开旧书店的门，门铃响了一声，里面没有人应。

她记得柜台后面有一叠没写完的信，落款都是同一个名字。
`,
      },
      {
        id: "note2",
        name: "note2",
        updatedAt: 0,
        body: `第二天林夏又去了那家店。门铃没响。信不见了，只剩一张纸条，上面写着再来。

她把这句话抄进稿纸，不知道那是提示，还是有人在改她的小说。
`,
      },
    ],
  },
];

function stamp(volumes: Volume[]): Volume[] {
  const now = Date.now();
  return volumes.map((v) => ({
    ...v,
    notes: v.notes.map((n) => ({ ...n, updatedAt: n.updatedAt || now })),
  }));
}

function isVolumeList(value: unknown): value is Volume[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (v) =>
        v &&
        typeof v === "object" &&
        typeof (v as Volume).id === "string" &&
        typeof (v as Volume).name === "string" &&
        Array.isArray((v as Volume).notes),
    )
  );
}

export function loadVolumes(): Volume[] {
  if (typeof window === "undefined") return STARTER;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isVolumeList(parsed)) return parsed;
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const notes = JSON.parse(legacy) as Note[];
      if (Array.isArray(notes) && notes.length > 0) {
        return [{ id: "vol-legacy", name: "第一篇", notes }];
      }
    }
  } catch {
    /* fall through */
  }
  return stamp(STARTER);
}

export function saveVolumes(volumes: Volume[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(volumes));
}
